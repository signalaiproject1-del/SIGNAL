import importlib.util
from pathlib import Path
import unittest
spec = importlib.util.spec_from_file_location('import_sources', Path(__file__).resolve().parents[1] / 'scripts/import_sources.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ImportTests(unittest.TestCase):
    def test_text_is_decoded_and_scripts_excluded(self):
        self.assertEqual(module.text('<p>Heat &amp; power</p><script>bad()</script><p>Next</p>'), 'Heat & power\nNext')
    def test_dates_and_status_are_not_conflated(self):
        page = {'content_id':'id', 'title':'Policy', 'document_type':'open_consultation', 'first_published_at':'2017-12-07', 'public_updated_at':'2026-09-14', 'updated_at':'2026-10-19', 'details': {'closing_date':'2026-11-08', 'release_timestamp':'2026-10-20'}}
        result = module.normalize(page, [], [])
        self.assertEqual(result['published_at'], '2017-12-07')
        self.assertEqual(result['updated_at'], '2026-09-14')
        self.assertEqual(result['closing_at'], '2026-11-08')
        self.assertEqual(result['release_at'], '2026-10-20')
        self.assertEqual(result['document_type'], 'open_consultation')
    def test_unexpected_hosts_are_rejected(self):
        for url in ['https://example.com/test', 'https://www.gov.uk.evil.com/a', 'http://www.gov.uk/a']:
            with self.assertRaises(module.CollectionError): module.official_url(url)
    def test_sql_treats_source_quotes_as_data(self):
        sql = module.sql_for([{'title': "government's \\ policy"}])
        self.assertIn("government''s", sql)
        self.assertTrue(sql.startswith('SET standard_conforming_strings = on;'))
    def test_pdf_coverage_is_explicit(self):
        page = {'content_id':'id','title':'Report','document_type':'policy_paper'}
        result = module.normalize(page, [], [{'format':'PDF'}])
        self.assertIn('text extracted from 0 PDF pages', result['coverage'])



from unittest.mock import patch
from io import BytesIO
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject

def pdf_bytes(words='Evidence on heat pumps', blank=False):
    writer = PdfWriter()
    page = writer.add_blank_page(width=300, height=300)
    if not blank:
        font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
        page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
        stream = DecodedStreamObject()
        stream.set_data(f'BT /F1 12 Tf 10 100 Td ({words}) Tj ET'.encode())
        page[NameObject('/Contents')] = writer._add_object(stream)
    out = BytesIO(); writer.write(out)
    return out.getvalue()

class PDFTests(unittest.TestCase):
    def test_text_keeps_original_page_link_and_binary_hash(self):
        data = pdf_bytes()
        sections, metadata = module.extract_pdf(data, 'Report', 'https://assets.publishing.service.gov.uk/report.pdf')
        self.assertEqual(metadata['page_count'], 1)
        self.assertEqual(metadata['text_pages'], 1)
        self.assertEqual(metadata['visual_analysis_status'], 'not_run')
        self.assertEqual(metadata['sha256'], module.hashlib.sha256(data).hexdigest())
        self.assertEqual(sections[0]['page'], 1)
        self.assertTrue(sections[0]['url'].endswith('#page=1'))
        self.assertIn('heat pumps', sections[0]['text'])
    def test_blank_or_scanned_pdf_is_not_claimed_searchable(self):
        sections, metadata = module.extract_pdf(pdf_bytes(blank=True), 'Scan', 'https://www.gov.uk/scan.pdf')
        self.assertEqual(sections, [])
        self.assertEqual(metadata['extraction_status'], 'no_text')
        self.assertEqual(metadata['pages_without_text'], [1])
    def test_bad_and_oversized_pdfs_fail_without_partial_records(self):
        with self.assertRaises(module.CollectionError): module.extract_pdf(b'<html>error</html>', 'Bad', 'https://www.gov.uk/a.pdf')
        with patch.object(module, 'MAX_PAGES', 0):
            with self.assertRaises(module.CollectionError): module.extract_pdf(pdf_bytes(), 'Long', 'https://www.gov.uk/a.pdf')
    def test_changed_pdf_at_same_url_changes_version(self):
        page = {'content_id':'id', 'title':'Report', 'document_type':'policy_paper', 'base_path':'/report', 'details': {'attachments':[{'title':'PDF', 'url':'https://www.gov.uk/report.pdf','content_type':'application/pdf'}]}}
        with patch.object(module, 'fetch_page', return_value=page), patch.object(module, 'download', side_effect=[pdf_bytes('Original'),pdf_bytes('Revised')]):
            first = module.collect('https://www.gov.uk/report')
            second = module.collect('https://www.gov.uk/report')
        self.assertNotEqual(first['content_hash'], second['content_hash'])
        self.assertEqual(first['source_url'], second['source_url'])
    def test_one_source_failure_does_not_discard_successful_sources(self):
        with patch.object(module, 'collect', side_effect=[{'source_url':'https://www.gov.uk/a'}, module.CollectionError('download_failed')]):
            records, failures = module.collect_all(['https://www.gov.uk/a','https://www.gov.uk/b'])
        self.assertEqual(len(records), 1)
        self.assertEqual(failures, [{'source_url':'https://www.gov.uk/b','code':'download_failed'}])
    def test_retired_announcement_with_empty_title_is_a_per_source_failure(self):
        url='https://www.gov.uk/government/statistics/announcements/retired'
        with patch.object(module, 'fetch_page', return_value={'title': '', 'base_path': '/government/statistics/announcements/retired'}):
            records, failures=module.collect_all([url])
        self.assertEqual(records, [])
        self.assertEqual(failures, [{'source_url':url,'code':'collection_failed'}])

if __name__ == '__main__': unittest.main()
