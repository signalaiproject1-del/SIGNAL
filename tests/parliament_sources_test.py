import sys
import json
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1] / 'scripts'))
from import_sources import collect_statement, CollectionError, official_url
from discover_sources import parse_feed

class ParliamentSources(unittest.TestCase):
    def setUp(self):
        self.value={'id':123,'dateMade':'2026-10-23T00:00:00','uin':'HCWS42','title':'Energy update','text':'<p>Full statement.</p>','house':'Commons','answeringBodyName':'DESNZ','attachments':[]}
        self.url='https://questions-statements.parliament.uk/written-statements/detail/2026-10-23/HCWS42'
    def test_discovers_bounded_canonical_statements(self):
        feed={'id':'parliament-statements','kind':'parliament_statements','limit':5}
        result=parse_feed(json.dumps({'results':[{'value':self.value}]*8}).encode(),feed)
        self.assertEqual(result,[{'source_url':self.url,'feed_id':'parliament-statements'}])
        with self.assertRaises(CollectionError): parse_feed(b'{"results":[]}',feed)
        self.value['uin']='../../private'
        with self.assertRaises(CollectionError): parse_feed(json.dumps({'results':[{'value':self.value}]}).encode(),feed)
    def test_full_statement_and_no_invented_update_date(self):
        with patch('import_sources.download',return_value=json.dumps({'value':self.value}).encode()) as fetch:
            result=collect_statement(self.url,'uk-parliament')
            self.assertIn('/2026-10-23/HCWS42',fetch.call_args.args[0])
            self.assertEqual(result['content']['sections'][0]['text'],'Full statement.')
            self.assertIsNone(result['content']['updated_at'])
            self.assertEqual(result['content']['organisation_slugs'],['uk-parliament'])
    def test_mismatched_identity_and_foreign_attachments_fail_closed(self):
        self.value['uin']='HCWS43'
        with patch('import_sources.download',return_value=json.dumps({'value':self.value}).encode()):
            with self.assertRaises(CollectionError): collect_statement(self.url)
        for url in ['https://qna.files.parliament.uk.evil.test/file.pdf','https://user@qna.files.parliament.uk/file.pdf','http://questions-statements-api.parliament.uk/data']:
            with self.assertRaises(CollectionError): official_url(url)
    def test_pdf_spaces_are_encoded(self):
        self.assertEqual(official_url('https://qna.files.parliament.uk/report name.pdf'),'https://qna.files.parliament.uk/report%20name.pdf')
if __name__=='__main__': unittest.main()
