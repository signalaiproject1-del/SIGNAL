"""Bounded discovery from explicitly configured GOV.UK publication feeds."""
import re
import json
import xml.etree.ElementTree as ET
from urllib.parse import urlparse
from import_sources import CollectionError, download, statement_url

NS = {'a': 'http://www.w3.org/2005/Atom'}
PUBLICATION_PATH = re.compile(r'/government/(?:publications|consultations)/[a-z0-9][a-z0-9-]*\Z')

def parse_feed(data, feed):
    if feed.get('kind') == 'parliament_statements':
        if len(data) > 2_000_000: raise CollectionError('invalid_feed')
        try:
            values = json.loads(data)['results']
            urls = list(dict.fromkeys(statement_url(item['value']) for item in values))
            if not urls: raise ValueError('empty')
            return [{'source_url': url, 'feed_id': feed['id']} for url in urls[:feed['limit']]]
        except (KeyError, ValueError, TypeError) as exc:
            raise CollectionError('invalid_feed') from exc
    if len(data) > 2_000_000 or b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
        raise CollectionError('invalid_feed')
    try:
        root = ET.fromstring(data)
    except ET.ParseError as exc:
        raise CollectionError('invalid_feed') from exc
    if root.tag != '{http://www.w3.org/2005/Atom}feed':
        raise CollectionError('invalid_feed')
    candidates, seen = [], set()
    for entry in root.findall('a:entry', NS):
        for link in entry.findall('a:link', NS):
            if link.get('rel', 'alternate') != 'alternate':
                continue
            value = link.get('href', '')
            url = urlparse(value)
            if (url.scheme != 'https' or url.netloc != 'www.gov.uk' or url.query or url.fragment
                    or not PUBLICATION_PATH.fullmatch(url.path)):
                continue
            if value not in seen:
                seen.add(value)
                candidates.append({'source_url': value, 'feed_id': feed['id']})
            if len(candidates) >= feed['limit']:
                return candidates
    # A broken/changed feed must not silently look like a successful empty refresh.
    if not candidates:
        raise CollectionError('invalid_feed')
    return candidates

def discover(feeds):
    candidates, failures = [], []
    for feed in feeds:
        try:
            candidates.extend(parse_feed(download(feed['atom_url']), feed))
        except Exception as exc:
            code = str(exc) if isinstance(exc, CollectionError) else 'invalid_feed'
            failures.append({'source_url': feed['url'], 'code': code})
    return candidates, failures
