'use client';
import { useState } from 'react';
import type { Source } from '@/lib/sources';

const labels: Record<string, string> = {
  open_consultation: 'Open consultation', closed_consultation: 'Closed consultation',
  consultation_outcome: 'Consultation outcome', policy_paper: 'Policy paper',
  national_statistics_announcement: 'Statistics announcement', statistics_announcement: 'Statistics announcement',
};
function date(value: string | null, time = false) {
  if (!value) return 'Not stated';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London', ...(time ? { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' } as const : {}) }).format(new Date(value));
}
function typeLabel(type: string) { return labels[type] || type.replaceAll('_', ' '); }
function updated(source: Source) { return Date.parse(source.content.updated_at || source.content.published_at || '') || 0; }
export default function Feed({ sources }: { sources: Source[] }) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [sort, setSort] = useState('updated');
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const results = sources.filter(source => {
    const c = source.content;
    const haystack = [c.title, c.description, c.publisher, ...c.sections.map(s => s.text)].join(' ').toLocaleLowerCase();
    return (type === 'all' || c.document_type === type) && terms.every(term => haystack.includes(term));
  }).sort((a, b) => sort === 'title' ? a.content.title.localeCompare(b.content.title) : updated(b) - updated(a));
  const types = [...new Set(sources.map(s => s.content.document_type))].sort();
  const oldestCheck = sources.map(s => s.checked_at).sort()[0];
  return <section className="feed" aria-labelledby="feed-title">
    <div className="section-heading"><div><p className="eyebrow">THE EVIDENCE DESK</p><h2 id="feed-title">Energy &amp; climate policy</h2></div><span className="source-count">{sources.length} official sources</span></div>
    <div className="filters">
      <label className="search">Search sources<input type="search" placeholder="Try heat pumps, nuclear or research…" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <label>Document type<select value={type} onChange={e => setType(e.target.value)}><option value="all">All document types</option>{types.map(t => <option key={t} value={t}>{typeLabel(t)}</option>)}</select></label>
      <label>Sort by<select value={sort} onChange={e => setSort(e.target.value)}><option value="updated">Latest source update</option><option value="title">Title A–Z</option></select></label>
    </div>
    <div className="results-line"><p role="status" aria-live="polite">{results.length} of {sources.length} sources{query.trim() ? ` matching “${query.trim()}”` : ''}</p><p>{oldestCheck ? `Sources checked ${date(oldestCheck)}` : 'No sources imported yet'}</p></div>
    <p className="scope-note">Search covers imported page text and HTML documents. PDF contents are not yet included. Descriptions below are from GOV.UK; no AI analysis has been added.</p>
    {results.length === 0 && <div className="empty"><h3>No matching sources</h3><p>Try a broader search or clear the document filter.</p><button onClick={() => { setQuery(''); setType('all'); }}>Clear filters</button></div>}
    <div className="source-list">{results.map(source => {
      const c = source.content;
      return <article className="source-card" key={source.source_url}>
        <div className="card-top"><span className={`badge ${c.document_type.includes('consultation') ? 'consultation' : ''}`}>{typeLabel(c.document_type)}</span>{c.withdrawn && <span className="badge">Withdrawn</span>}<span className="publisher">GOV.UK</span></div>
        <h3><a href={source.source_url} target="_blank" rel="noreferrer">{c.title}<span aria-hidden="true"> ↗</span><span className="sr-only"> (opens GOV.UK in a new tab)</span></a></h3>
        <p className="description">{c.description || 'No description provided by the publisher.'}</p>
        <dl className="dates"><div><dt>First published</dt><dd>{date(c.published_at)}</dd></div><div><dt>Source updated</dt><dd>{date(c.updated_at)}</dd></div>{c.closing_at && <div className="deadline"><dt>Consultation deadline</dt><dd>{date(c.closing_at, true)}</dd></div>}{c.release_at && <div><dt>Scheduled release</dt><dd>{date(c.release_at, true)}</dd></div>}</dl>
        {c.document_type.includes('consultation') && <p className="context-note">Consultation record — proposals should not be treated as enacted policy.</p>}
        {c.document_type.includes('announcement') && <p className="context-note">Release announcement — this record does not contain the published price figures.</p>}
        {c.change_history[0] && <div className="change-note"><strong>Latest publisher change note</strong><p>{c.change_history[0].note}</p></div>}
        <details><summary>Read imported text &amp; source details</summary><div className="source-detail"><p className="scope-note">{c.coverage}. Text formatting is simplified; check the original for tables and layout.</p><p className="scope-note">Publisher: {c.publisher}<br/>First collected {date(source.collected_at)} · Last checked {date(source.checked_at, true)}</p>
          {c.attachments.length > 0 && <nav aria-label={`Attachments for ${c.title}`} className="attachments">{c.attachments.map(a => <a key={a.url} href={a.url} target="_blank" rel="noreferrer">{a.format} · {a.title} ↗{a.format === 'PDF' ? ' (not searched)' : ''}</a>)}</nav>}
          {c.sections.filter(s => s.text).map(s => <section key={s.url} className="extracted"><h4><a href={s.url} target="_blank" rel="noreferrer">{s.title} ↗</a></h4><p>{s.text}</p></section>)}
          {!c.sections.some(s => s.text) && <p>The publisher provides announcement metadata only. Follow the original source for release information.</p>}
          {c.change_history.length > 1 && <details><summary>Publisher update history ({c.change_history.length})</summary><ol className="history">{c.change_history.map((change, i) => <li key={`${change.public_timestamp}-${i}`}><time>{date(change.public_timestamp)}</time><p>{change.note}</p></li>)}</ol></details>}
        </div></details>
      </article>;
    })}</div>
    <p className="scope-note feed-end">Curated pilot · refreshed manually · official source text may change after collection. Source material: <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/" target="_blank" rel="noreferrer">Open Government Licence v3.0</a>, except where otherwise stated.</p>
  </section>;
}
