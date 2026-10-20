"""GitHub Actions entrypoint. Uses short-lived OIDC identity, no database credential."""
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from import_sources import ROOT, collect_all

ENDPOINT = 'https://epegqqlcfnakppnmpmyy.supabase.co/functions/v1/source-import'

def submit(payload):
    # Obtain a fresh identity for each request; never persist or print it.
    token_url = os.environ['ACTIONS_ID_TOKEN_REQUEST_URL'] + '&' + urlencode({'audience': ENDPOINT})
    token_request = Request(token_url, headers={'Authorization': 'Bearer ' + os.environ['ACTIONS_ID_TOKEN_REQUEST_TOKEN']})
    with urlopen(token_request, timeout=30) as response:
        token = json.load(response)['value']
    request = Request(ENDPOINT, data=json.dumps(payload, ensure_ascii=False).encode(),
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}, method='POST')
    with urlopen(request, timeout=90) as response:
        return json.load(response)

def main():
    urls = json.loads((ROOT / 'scripts/sources.json').read_text())
    submit({'phase': 'start'})
    records, failures = collect_all(urls)
    result = submit({'phase': 'finish', 'records': records, 'failures': failures})
    summary = f"## SIGNAL source refresh\n\nImported {len(records)} of {len(urls)} sources. Failed: {len(failures)}.\n"
    summary += f"Extracted PDF pages: {sum(a.get('text_pages', 0) for r in records for a in r['content']['attachments'])}.\n"
    summary += '\nFailed sources retain their previous successful copy. See the source library for coverage and page links.\n'
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        Path(os.environ['GITHUB_STEP_SUMMARY']).write_text(summary)
    print(json.dumps(result))
    return 1 if failures else 0

if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        # No credential-bearing request details or response bodies in public logs.
        print('Refresh could not complete. Check the import status and Supabase function logs.')
        sys.exit(1)
