"""Collect curated GOV.UK pages and PDF text, preserving page-level provenance."""
import argparse
import hashlib
import io
import json
import logging
import os
import subprocess
import tempfile
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
MAX_DOWNLOAD = 25 * 1024 * 1024
MAX_PAGES = 400
MAX_PAGE_STREAM = 20 * 1024 * 1024
MAX_TEXT = 1_500_000
logging.getLogger('pypdf').setLevel(logging.ERROR)

class CollectionError(Exception):
    """A safe, bounded error code suitable for public import status."""

class TextParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.skip = [], 0
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
    if (parsed.scheme != 'https' or parsed.hostname not in ('www.gov.uk', 'assets.publishing.service.gov.uk')
            or parsed.username or parsed.password or parsed.port not in (None, 443)):
        raise CollectionError('source_not_allowed')
    return url

def download(url):
    """Do not follow redirects: only the explicitly allowed official host is fetched."""
    url = official_url(url)
    with tempfile.TemporaryDirectory() as folder:
        body = Path(folder) / 'body'
        try:
            result = subprocess.run(['curl', '--silent', '--show-error', '--fail', '--proto', '=https',
                '--connect-timeout', '15', '--max-time', '90', '--retry', '2', '--max-filesize', str(MAX_DOWNLOAD),
                '--output', str(body), '--write-out', '%{http_code}', url], check=True, capture_output=True, timeout=300)
            if result.stdout.strip() != b'200': raise CollectionError('download_failed')
            if body.stat().st_size > MAX_DOWNLOAD: raise CollectionError('size_limit')
            return body.read_bytes()
        except (subprocess.SubprocessError, OSError) as exc:
            raise CollectionError('download_failed') from exc

def fetch_page(url):
    url = official_url(url)
    if urlparse(url).hostname != 'www.gov.uk': raise CollectionError('source_not_allowed')
    return json.loads(download('https://www.gov.uk/api/content' + urlparse(url).path))

def extract_pdf(data, title, url):
    if not data.startswith(b'%PDF-'): raise CollectionError('invalid_pdf')
    try:
        reader = PdfReader(io.BytesIO(data), strict=False)
        if reader.is_encrypted: raise CollectionError('encrypted_pdf')
        if len(reader.pages) > MAX_PAGES: raise CollectionError('page_limit')
        sections, empty_pages, total = [], [], 0
        for number, page in enumerate(reader.pages, 1):
            stream = page.get_contents()
            if stream and len(stream.get_data()) > MAX_PAGE_STREAM: raise CollectionError('size_limit')
            value = (page.extract_text() or '').replace('\x00', '').strip()
            total += len(value)
            if total > MAX_TEXT: raise CollectionError('size_limit')
            if not value:
                empty_pages.append(number)
            else:
                sections.append({'title': f'{title} · PDF page {number}', 'url': f'{url}#page={number}',
                                 'text': value, 'format': 'PDF', 'page': number})
        return sections, {'sha256': hashlib.sha256(data).hexdigest(), 'page_count': len(reader.pages),
            'text_pages': len(sections), 'pages_without_text': empty_pages,
            'extraction_status': 'no_text' if not sections else ('partial' if empty_pages else 'extracted')}
    except CollectionError:
        raise
    except Exception as exc:
        raise CollectionError('pdf_extraction_failed') from exc

def normalize(page, sections, attachments):
    details = page.get('details', {})
    pdfs = [a for a in attachments if a['format'] == 'PDF']
    pages = sum(a.get('text_pages', 0) for a in pdfs)
    missing = sum(len(a.get('pages_without_text', [])) for a in pdfs)
    coverage = 'Available GOV.UK page text and HTML attachments'
    if pdfs:
        coverage += f'; text extracted from {pages} PDF pages'
        if missing: coverage += f'; {missing} pages have no extractable text (blank or requiring OCR)'
    return {
        'source_id': page['content_id'], 'title': page['title'],
        'description': text(page.get('description', '')),
        'document_type': page['document_type'],
        'publisher': ', '.join(x['title'] for x in page.get('links', {}).get('organisations', [])) or 'GOV.UK',
        'published_at': page.get('first_published_at') or details.get('first_public_at'),
        'updated_at': page.get('public_updated_at'), 'closing_at': details.get('closing_date'),
        'release_at': details.get('release_timestamp'), 'withdrawn': bool(page.get('withdrawn_notice')),
        'change_history': details.get('change_history', []), 'sections': sections, 'attachments': attachments,
        'coverage': coverage, 'extraction_version': 2,
    }

def collect(url):
    page = fetch_page(url)
    sections = [{'title': 'Publication page', 'url': url, 'text': text(page.get('details', {}).get('body', ''))}]
    attachments, seen = [], set()
    for a in page.get('details', {}).get('attachments', []):
        target = official_url(a['url'])
        if target in seen: continue
        seen.add(target)
        is_html = a.get('attachment_type') == 'html'
        is_pdf = a.get('content_type') == 'application/pdf' or urlparse(target).path.lower().endswith('.pdf')
        attachment = {'title': a['title'], 'url': target, 'format': 'HTML' if is_html else ('PDF' if is_pdf else 'File')}
        if is_html:
            child = fetch_page(target)
            sections.append({'title': child['title'], 'url': target, 'text': text(child.get('details', {}).get('body', ''))})
        elif is_pdf:
            pdf_sections, metadata = extract_pdf(download(target), a['title'], target)
            sections.extend(pdf_sections)
            attachment.update(metadata)
        attachments.append(attachment)
    content = normalize(page, sections, attachments)
    digest = hashlib.sha256(json.dumps(content, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return {'source_url': official_url(page['base_path']), 'content': content, 'content_hash': digest,
            'checked_at': datetime.now(timezone.utc).isoformat()}

def collect_all(urls):
    records, failures = [], []
    for url in urls:
        try:
            records.append(collect(url))
        except Exception as exc:
            code = str(exc) if isinstance(exc, CollectionError) else 'collection_failed'
            failures.append({'source_url': url, 'code': code})
            print(f'Refresh failed: {url} ({code}); previous database version will be retained.')
    return records, failures

def sql_for(records):
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
    records, failures = collect_all(json.loads((ROOT / 'scripts/sources.json').read_text()))
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    # Remove obsolete output first so a failed refresh cannot leave apparently current SQL.
    (output / 'import.sql').unlink(missing_ok=True)
    (output / 'sources.json').write_text(json.dumps(records, ensure_ascii=False))
    (output / 'failures.json').write_text(json.dumps(failures))
    if failures: raise SystemExit('Collection incomplete. No SQL produced; inspect failures.json.')
    (output / 'import.sql').write_text(sql_for(records))
    print(f'{len(records)} sources prepared in {output}.')

if __name__ == '__main__': main()
