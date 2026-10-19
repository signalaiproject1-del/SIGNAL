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
            with self.assertRaises(ValueError): module.official_url(url)
    def test_sql_treats_source_quotes_as_data(self):
        sql = module.sql_for([{'title': "government's \\ policy"}])
        self.assertIn("government''s", sql)
        self.assertTrue(sql.startswith('SET standard_conforming_strings = on;'))
    def test_pdf_coverage_is_explicit(self):
        page = {'content_id':'id','title':'Report','document_type':'policy_paper'}
        result = module.normalize(page, [], [{'format':'PDF'}])
        self.assertIn('PDFs linked, not searched', result['coverage'])

if __name__ == '__main__': unittest.main()
