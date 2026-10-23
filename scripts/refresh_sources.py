"""GitHub Actions entrypoint. Uses short-lived OIDC identity, no database credential."""
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from import_sources import ROOT, collect_all
from discover_sources import discover

ENDPOINT = 'https://epegqqlcfnakppnmpmyy.supabase.co/functions/v1/source-import'

def submit(payload):
    # Obtain a fresh identity for each request; never persist or print it.
    token_url = os.environ['ACTIONS_ID_TOKEN_REQUEST_URL'] + '&' + urlencode({'audience': ENDPOINT})
    token_request = Request(token_url, headers={'Authorization': 'Bearer ' + os.environ['ACTIONS_ID_TOKEN_REQUEST_TOKEN']})
    try:
        with urlopen(token_request, timeout=30) as response:
            token = json.load(response)['value']
    except HTTPError as exc:
        print(f"GitHub identity request rejected (HTTP {exc.code}).")
        raise
    request = Request(ENDPOINT, data=json.dumps(payload, ensure_ascii=False).encode(),
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}, method='POST')
    try:
        with urlopen(request, timeout=90) as response:
            return json.load(response)
    except HTTPError as exc:
        # Status and payload size are safe; response bodies and tokens are not.
        print(f"Import service rejected {payload['phase']} (HTTP {exc.code}, {len(request.data)} bytes).")
        raise

def main():
    feeds = json.loads((ROOT / 'scripts/source_feeds.json').read_text())
    candidates, discovery_failures = discover(feeds)
    started = submit({'phase': 'start', 'records': candidates, 'failures': discovery_failures})
    # The database returns the approved, persistent target set. Older documents
    # remain monitored after they leave the feed's newest five entries.
    targets = started['targets']
    urls = [target['source_url'] for target in targets]
    organisations = {target['source_url']: target['organisation'] for target in targets if target['organisation']}
    records, failures = collect_all(urls, organisations)
    result = submit({'phase': 'finish', 'records': records, 'failures': failures})
    summary = f"## SIGNAL source refresh\n\nImported {len(records)} of {len(urls)} sources. Failed: {len(failures)}.\n"
    summary += f"Extracted PDF pages: {sum(a.get('text_pages', 0) for r in records for a in r['content']['attachments'])}.\n"
    summary += f"New sources: {started['discovered_count']}. Feed failures: {len(discovery_failures)}. Capacity skips: {started['discovery_skipped']}.\n"
    summary += 'Discovery checks the newest five entries per feed, not the full publication archive. Graphs and diagrams are not AI-analysed.\n'
    summary += '\nFailed sources retain their previous successful copy. See the source library for coverage and page links.\n'
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        Path(os.environ['GITHUB_STEP_SUMMARY']).write_text(summary)
    print(json.dumps(result))
    return 1 if failures or discovery_failures else 0

if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as exc:
        # No credential-bearing request details or response bodies in public logs.
        print(f'Refresh could not complete ({type(exc).__name__}). Check the import status and Supabase function logs.')
        sys.exit(1)
