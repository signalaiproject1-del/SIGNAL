import json
import io
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from contextlib import redirect_stdout

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import discover_sources as discovery
import import_sources as importer
import refresh_sources as runner

FEED = {'id': 'desnz-policy', 'limit': 2, 'url': 'https://www.gov.uk/search/policy-papers-and-consultations', 'atom_url': 'https://www.gov.uk/feed.atom'}

def atom(links):
    return ('<feed xmlns="http://www.w3.org/2005/Atom">' + ''.join(
        f'<entry><link rel="alternate" href="{url}" /></entry>' for url in links) + '</feed>').encode()

class DiscoveryTests(unittest.TestCase):
    def test_feed_is_bounded_deduplicated_and_excludes_offsite_or_nested_links(self):
        first = 'https://www.gov.uk/government/consultations/first'
        second = 'https://www.gov.uk/government/publications/second'
        data = atom(['https://evil.example/policy', 'https://www.gov.uk/government/publications/doc/attachment', first, first, second,
                     'https://www.gov.uk/government/publications/third'])
        self.assertEqual([x['source_url'] for x in discovery.parse_feed(data, FEED)], [first, second])

    def test_invalid_empty_and_entity_feeds_do_not_look_successful(self):
        for data in [b'<html/>', b'broken', atom([]), b'<!DOCTYPE feed><feed/>', b'<!ENTITY test "bad">']:
            with self.assertRaises(importer.CollectionError): discovery.parse_feed(data, FEED)

    def test_feed_failure_is_reported_without_removing_existing_targets(self):
        with patch.object(discovery, 'download', side_effect=importer.CollectionError('download_failed')):
            candidates, errors = discovery.discover([FEED])
        self.assertEqual(candidates, [])
        self.assertEqual(errors, [{'source_url': FEED['url'], 'code': 'download_failed'}])

    def test_publisher_and_document_type_checked_before_attachments_are_downloaded(self):
        url = 'https://www.gov.uk/government/publications/example'
        page = {'title': 'Example', 'base_path': '/government/publications/example', 'document_type': 'policy_paper', 'links': {'organisations': []}}
        with patch.object(importer, 'fetch_page', return_value=page), patch.object(importer, 'download') as download:
            with self.assertRaises(importer.CollectionError): importer.collect(url, 'department-for-energy-security-and-net-zero')
            download.assert_not_called()

    def test_runner_uses_database_targets_even_when_discovery_fails(self):
        url = 'https://www.gov.uk/government/publications/previously-discovered'
        failures = [{'source_url': FEED['url'], 'code': 'download_failed'}]
        started = {'targets': [{'source_url': url, 'organisation': 'department-for-energy-security-and-net-zero'}], 'discovered_count': 0, 'discovery_skipped': 0}
        with patch.object(runner, 'discover', return_value=([], failures)), \
             patch.object(runner, 'submit', side_effect=[started, {'status': 'partial'}]) as submit, \
             patch.dict(runner.os.environ, {'GITHUB_STEP_SUMMARY': ''}), \
             patch.object(runner, 'collect_all', return_value=([{'content': {'attachments': []}}], [])) as collect:
            self.assertEqual(runner.main(), 1)
            collect.assert_called_once_with([url], {url: 'department-for-energy-security-and-net-zero'})
            self.assertEqual(submit.call_args_list[0].args[0]['failures'], failures)

    def test_http_diagnostics_do_not_expose_tokens_or_response_bodies(self):
        output = io.StringIO()
        error = HTTPError(runner.ENDPOINT, 413, 'secret-response', {}, io.BytesIO(b'secret-body'))
        with patch.dict(runner.os.environ, {'ACTIONS_ID_TOKEN_REQUEST_URL': 'https://example.invalid/?x=1', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN': 'secret-request-token'}), \
             patch.object(runner, 'urlopen', side_effect=[io.BytesIO(b'{"value":"secret-oidc-token"}'), error]), redirect_stdout(output):
            with self.assertRaises(HTTPError): runner.submit({'phase': 'finish', 'records': [], 'failures': []})
        self.assertIn('HTTP 413', output.getvalue())
        self.assertNotIn('secret', output.getvalue())

if __name__ == '__main__': unittest.main()
