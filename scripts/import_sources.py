"""Fetch the curated GOV.UK pilot. Produces SQL for an authenticated admin to apply.
No database secret is required or stored. PDF attachments are linked, not extracted.
"""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
import subprocess
from urllib.parse import urljoin, urlparse

ROOT = Path(__file__).resolve().parents[1]

class TextParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip = 0
    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'): self.skip += 1
        if tag in ('p', 'div', 'li', 'h1', 'h2', 'h3', 'br', 'tr'): self.parts.append('\n')
    def handle_endtag(self, tag):
        if tag in ('script', 'style'): self.skip = max(0, self.skip - 1)
        if tag in ('p', 'div', 'li', 'h1', 'h2', 'h3', 'tr'): self.parts.append('\n')
    def handle_data(self, data):
        if not self.skip: self.parts.append(data)

def text(html):
    parser = TextParser()
    parser.feed(html or '')
    return '\n'.join(line.strip() for line in ''.join(parser.parts).splitlines() if line.strip())

def official_url(value):
    url = urljoin('https://www.gov.uk', value)
    parsed = urlparse(url)
    if parsed.scheme != 'https' or parsed.hostname not in ('www.gov.uk', 'assets.publishing.service.gov.uk'):
        raise ValueError('Unexpected source host')
    return url

def fetch_page(url):
    url = official_url(url)
    if urlparse(url).hostname != 'www.gov.uk': raise ValueError('Content API requires GOV.UK')
    api = 'https://www.gov.uk/api/content' + urlparse(url).path
    result = subprocess.run(['curl', '--fail', '--silent', '--show-error', '--max-time', '30', '--retry', '2', api], check=True, capture_output=True)
    return json.loads(result.stdout)

def normalize(page, sections, attachments):
    details = page.get('details', {})
    return {
        'source_id': page['content_id'], 'title': page['title'],
        'description': text(page.get('description', '')),
        'document_type': page['document_type'],
        'publisher': ', '.join(x['title'] for x in page.get('links', {}).get('organisations', [])) or 'GOV.UK',
        'published_at': page.get('first_published_at') or details.get('first_public_at'),
        'updated_at': page.get('public_updated_at'),
        'closing_at': details.get('closing_date'),
        'release_at': details.get('release_timestamp'),
        'withdrawn': bool(page.get('withdrawn_notice')),
        'change_history': details.get('change_history', []),
        'sections': sections, 'attachments': attachments,
        'coverage': 'Landing page and HTML attachments; PDFs linked, not searched' if any(a['format'] == 'PDF' for a in attachments) else 'Available GOV.UK page text and HTML attachments',
    }

def collect(url):
    page = fetch_page(url)
    sections = [{'title': 'Publication page', 'url': url, 'text': text(page.get('details', {}).get('body', ''))}]
    attachments = []
    for a in page.get('details', {}).get('attachments', []):
        target = official_url(a['url'])
        is_html = a.get('attachment_type') == 'html'
        attachments.append({'title': a['title'], 'url': target, 'format': 'HTML' if is_html else ('PDF' if a.get('content_type') == 'application/pdf' else 'File')})
        if is_html:
            child = fetch_page(target)
            sections.append({'title': child['title'], 'url': target, 'text': text(child.get('details', {}).get('body', ''))})
    content = normalize(page, sections, attachments)
    digest = hashlib.sha256(json.dumps(content, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return {'source_url': official_url(page['base_path']), 'content': content, 'content_hash': digest, 'checked_at': datetime.now(timezone.utc).isoformat()}

def sql_for(records):
    # A quoted JSON string is data, never executable SQL. Escape apostrophes;
    # standard_conforming_strings prevents backslashes from changing quoting.
    value = json.dumps(records, ensure_ascii=False).replace("'", "''")
    return "SET standard_conforming_strings = on;\nBEGIN;\nCREATE TEMP TABLE signal_import ON COMMIT DROP AS SELECT * FROM jsonb_to_recordset('" + value + "'::jsonb) AS r(source_url text, content jsonb, content_hash text, checked_at timestamptz);\n" + """
INSERT INTO public.source_versions (source_url, content_hash, content, collected_at)
SELECT source_url, content_hash, content, checked_at FROM signal_import
ON CONFLICT (source_url, content_hash) DO NOTHING;
INSERT INTO public.source_documents (source_url, content, content_hash, collected_at, checked_at)
SELECT source_url, content, content_hash, checked_at, checked_at FROM signal_import
ON CONFLICT (source_url) DO UPDATE SET content = excluded.content,
content_hash = excluded.content_hash, checked_at = excluded.checked_at;
COMMIT;
"""

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default='/private/tmp/signal-import')
    args = parser.parse_args()
    urls = json.loads((ROOT / 'scripts/sources.json').read_text())
    records = []
    for url in urls:
        record = collect(url)
        records.append(record)
        print(record['content']['title'])
    # Write only when every source succeeds; failures never overwrite database data.
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    (output / 'sources.json').write_text(json.dumps(records, indent=2, ensure_ascii=False))
    (output / 'import.sql').write_text(sql_for(records))
    print(f'{len(records)} sources prepared in {output}. Apply import.sql with authenticated admin access.')

if __name__ == '__main__': main()
