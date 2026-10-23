'use client';
import { useEffect, useState } from 'react';
import { EVENT_TYPES, POLICY_STATUSES, validateReview, type ReviewRecord, type ReviewFact, type Draft } from '@/lib/review-validation';
import type { Source } from '@/lib/sources';
import type { ImportRun } from '@/lib/import-status';

type SourceSummary = { source_url: string; title: string; publisher: string; content_hash: string; checked_at: string; last_changed_at: string };
type DraftSummary = Omit<Draft, 'record'> & { title: string };
type Version = { content_hash: string; collected_at: string };
type SourceDetail = Source & { content_hash: string };
type Workspace = { sources: SourceSummary[]; drafts: DraftSummary[]; imports: { latest: ImportRun | null; error: boolean } };
type History = { action: string; revision: number; created_at: string };
const when = (date: string) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' }).format(new Date(date));
const blank = (title = ''): ReviewRecord => ({ title, summary: '', event_type: '', policy_status: '', policy_area: '', jurisdiction: 'United Kingdom', event_date: '', deadline: '', sectors: [], facts: [], watchpoints: [] });
const label = (value: string) => value.replaceAll('_', ' ');
const publicationLabel = (draft: Pick<Draft, 'published_revision' | 'revision'>) => !draft.published_revision ? 'Private draft' : draft.published_revision === draft.revision ? 'Published' : 'Published · private edits pending';

export default function ReviewWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [source, setSource] = useState<SourceDetail | null>(null);
  const [snapshot, setSnapshot] = useState<Source['content'] | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [viewVersion, setViewVersion] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [history, setHistory] = useState<History[]>([]);
  const [record, setRecord] = useState<ReviewRecord>(blank());
  const [dirty, setDirty] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [search, setSearch] = useState('');

  async function request(path = '', body?: unknown) {
    const response = await fetch(`/api/review${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'The request failed.');
    return result;
  }
  async function loadWorkspace() {
    const response = await fetch('/api/review', { cache: 'no-store' });
    if (response.status === 401) { setSignedOut(true); return; }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    setWorkspace(result); setSignedOut(false);
  }
  useEffect(() => {
    loadWorkspace().catch(e => setError(e.message)).finally(() => setBusy(false));
    if (new URLSearchParams(window.location.search).get('signin') === 'failed') setError('This sign-in link expired or was opened in a different browser. Request a fresh link and open it in this browser.');
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function edit(patch: Partial<ReviewRecord>) { setRecord(r => ({ ...r, ...patch })); setDirty(true); setConfirmed(false); setMessage(''); }
  function editFact(index: number, patch: Partial<ReviewFact>) { edit({ facts: record.facts.map((f, i) => i === index ? { ...f, ...patch } : f) }); }
  function canLeave() { return !dirty || window.confirm('Leave this draft without saving your latest changes?'); }
  async function openSource(url: string, existing?: Draft, version?: string) {
    const result = await request(`?source=${encodeURIComponent(url)}${version ? `&version=${version}` : ''}`);
    setSource(result.source); setVersions(result.versions); setSnapshot(result.snapshot?.content || null);
    setViewVersion(result.snapshot?.content_hash || result.source.content_hash);
    if (existing !== undefined) { setDraft(existing); setRecord(existing.record); }
  }
  async function selectSource(url: string) {
    if (!url || !canLeave()) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await openSource(url); setDraft(null); setHistory([]);
      setRecord(blank(workspace?.sources.find(s => s.source_url === url)?.title)); setDirty(false); setConfirmed(false);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function openDraft(id: string) {
    if (!canLeave()) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await request(`?id=${id}`);
      await openSource(result.draft.source_url, result.draft, result.draft.source_hash);
      setHistory(result.history); setDirty(false); setConfirmed(false);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function save(refreshSource = false): Promise<Draft> {
    const result = await request('', { action: 'save', id: draft?.id || null, revision: draft?.revision || 0, source_url: source?.source_url, source_hash: source?.content_hash, record, refresh_source: refreshSource });
    setDraft(result.draft); setDirty(false);
    return result.draft;
  }
  async function act(action: 'save' | 'publish' | 'unpublish' | 'refresh') {
    if (!source) return;
    const problem = action === 'unpublish' ? null : validateReview(record, action === 'publish');
    if (problem) { setError(problem); return; }
    if (action === 'publish' && (!confirmed || viewingDifferentVersion)) { setError('View the draft’s evidence version and check the confirmation before publishing.'); return; }
    if (action === 'unpublish' && !window.confirm('Remove this record from the public site? Your draft and history will be kept.')) return;
    setBusy(true); setError(''); setMessage('');
    try {
      let current = draft;
      if (action !== 'unpublish') current = await save(action === 'refresh');
      if (!current) return;
      if (action === 'refresh') { await openSource(source.source_url, current, current.source_hash); setConfirmed(false); }
      if (action === 'publish' || action === 'unpublish') {
        const result = await request('', { action, id: current.id, revision: current.revision, confirm: confirmed });
        current = result.draft; setDraft(result.draft);
      }
      const updated = await request(`?id=${current!.id}`); setHistory(updated.history);
      await loadWorkspace();
      setMessage(action === 'publish' ? 'Published. The checked record is now on the public site.' : action === 'unpublish' ? 'Removed from the public site. Your private draft is retained.' : action === 'refresh' ? 'Latest source version selected. Recheck every fact before publishing.' : 'Draft saved privately.');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function signIn(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try { await request('/auth', { email }); setMessage('Check your email for a sign-in link. Open it in this same browser. You can close this tab after signing in.'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function logout() {
    if (!canLeave()) return;
    setBusy(true);
    try { await request('/auth', { action: 'logout' }); setWorkspace(null); setSource(null); setDraft(null); setRecord(blank()); setDirty(false); setSignedOut(true); setMessage('Signed out.'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const content = snapshot || source?.content;
  const stale = !!draft && !!source && draft.source_hash !== source.content_hash;
  const viewingDifferentVersion = !!source && viewVersion !== (draft?.source_hash || source.content_hash);
  const evidence = source && content ? [{ title: 'Original publication page', url: source.source_url, format: 'HTML' }, ...content.attachments.filter(a => ['PDF','HTML'].includes(a.format))] : [];
  const failures = new Set(workspace?.imports.latest?.failures.map(f => f.source_url) || []);
  return <section className="review-workspace">
    {error && <p role="alert" className="review-alert">{error}</p>}
    {message && <p role="status" className="review-message">{message}</p>}
    {signedOut ? <form onSubmit={signIn} className="review-login"><h2>Editor sign-in</h2><p>Only the approved SIGNAL editor can access drafts or publish records. We’ll email a sign-in link; no password is needed.</p><label>Email address<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label><button disabled={busy} type="submit">{busy ? 'Sending…' : 'Email me a sign-in link'}</button></form>
    : !workspace ? <div className="empty"><p>{busy ? 'Loading your workspace…' : 'Workspace unavailable.'}</p>{!busy && <button onClick={() => { setBusy(true); loadWorkspace().catch(e => setError(e.message)).finally(() => setBusy(false)); }}>Try again</button>}</div>
    : <>
      <div className="review-toolbar"><p>Private workspace · {workspace.sources.length} sources · latest {workspace.drafts.length} drafts</p><button className="secondary" disabled={busy} onClick={logout}>Sign out</button></div>
      <div className="review-queue"><div><h2>Start from a source</h2><label>Find a document<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search titles or publishers" /></label><label>Choose a source<select disabled={busy} value={source?.source_url || ''} onChange={e => selectSource(e.target.value)}><option value="">Select a publication…</option>{workspace.sources.filter(s => `${s.title} ${s.publisher}`.toLowerCase().includes(search.toLowerCase())).map(s => <option key={s.source_url} value={s.source_url}>{failures.has(s.source_url) ? 'Needs attention · ' : ''}{s.title}</option>)}</select></label><p className="scope-note">Choosing a source starts a new draft. Existing drafts are listed alongside. AI extraction is disabled.</p>{workspace.imports.error && <p role="alert">Import status is unavailable.</p>}{workspace.imports.latest?.failures.length ? <details><summary>Sources needing attention ({workspace.imports.latest.failures.length})</summary><ul>{workspace.imports.latest.failures.map(f => <li key={f.source_url}><a href={f.source_url} target="_blank" rel="noreferrer">{workspace.sources.find(s => s.source_url === f.source_url)?.title || f.source_url}</a> — {label(f.code)}. Last valid copy retained where available.</li>)}</ul></details> : null}</div>
      <div><h2>Continue a draft</h2>{!workspace.drafts.length ? <p className="scope-note">No drafts yet. Select a source to begin.</p> : <ul className="draft-list">{workspace.drafts.map(d => <li key={d.id}><button className="secondary" disabled={busy} onClick={() => openDraft(d.id)}>{d.title || 'Untitled draft'}</button><span className="scope-note">{publicationLabel(d)} · {when(d.updated_at)}</span></li>)}</ul>}</div></div>
      {source && content && <div className="review-columns"><aside className="review-source"><h2>Source evidence</h2><a href={source.source_url} target="_blank" rel="noreferrer">{source.content.title} ↗</a><p className="scope-note">{source.content.publisher}<br/>Last successful check: {when(source.checked_at)} (UK time)</p>{failures.has(source.source_url) && <p className="review-alert">The latest refresh failed. Check the original before relying on this stored copy.</p>}
        <label>Stored source version<select disabled={busy} value={viewVersion} onChange={async e => { setBusy(true); setConfirmed(false); setError(''); try { await openSource(source.source_url, undefined, e.target.value); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } }}>{versions.map(v => <option key={v.content_hash} value={v.content_hash}>{when(v.collected_at)}{v.content_hash === source.content_hash ? ' · latest' : ''}</option>)}</select></label>
        <p className="scope-note">Viewing an older version does not change the draft’s evidence version. Original links always lead to the publisher’s current file.</p>{viewingDifferentVersion && <p className="review-alert">You are viewing a different version. Return to the draft’s evidence version before editing citations or publishing.</p>}
        <details><summary>Read stored text</summary>{content.sections.filter(s => s.text).map((s, i) => <details key={`${s.url}-${i}`} className="extracted"><summary>{s.title}</summary><p>{s.text}</p></details>)}</details>
        <nav className="attachments" aria-label="Original source files">{content.attachments.map(a => <a key={a.url} href={a.url} target="_blank" rel="noreferrer">{a.format} · {a.title} ↗</a>)}</nav><p className="scope-note">Graphs and diagrams have not been analysed. Check visual evidence in the original PDF.</p>
      </aside><div className="review-editor"><div className="card-top"><span className="badge">{draft ? publicationLabel(draft) : 'New private draft'}</span>{dirty && <span className="badge">Unsaved changes</span>}</div>
        {stale && <div className="review-alert"><p>The source has changed since this draft was started. Compare versions and recheck your facts.</p><button disabled={busy} onClick={() => act('refresh')}>Use latest source for this draft</button></div>}
        <form onSubmit={e => { e.preventDefault(); act('save'); }}>
          <fieldset disabled={busy}><legend>Policy record</legend>
          <label>Title<input value={record.title} maxLength={300} onChange={e => edit({ title: e.target.value })} /></label>
          <label>What changed?<textarea rows={4} maxLength={5000} value={record.summary} onChange={e => edit({ summary: e.target.value })} placeholder="Summarise only what the evidence supports." /></label>
          <div className="review-fields"><label>Event type<select value={record.event_type} onChange={e => edit({ event_type: e.target.value })}><option value="">Choose…</option>{EVENT_TYPES.map(v => <option key={v} value={v}>{label(v)}</option>)}</select></label><label>Policy status<select value={record.policy_status} onChange={e => edit({ policy_status: e.target.value })}><option value="">Choose…</option>{POLICY_STATUSES.map(v => <option key={v} value={v}>{label(v)}</option>)}</select></label><label>Policy area<input value={record.policy_area} maxLength={300} onChange={e => edit({ policy_area: e.target.value })} placeholder="For example, housing or taxation" /></label><label>Jurisdiction<input value={record.jurisdiction} maxLength={300} onChange={e => edit({ jurisdiction: e.target.value })} /></label><label>Event date<input type="date" value={record.event_date} onChange={e => edit({ event_date: e.target.value })} /></label><label>Deadline, if any<input type="date" value={record.deadline} onChange={e => edit({ deadline: e.target.value })} /></label></div>
          <p className="scope-note">Use the date of the announcement or policy event. A document update is not necessarily a new event. A consultation is a proposal.</p>
          <label>Sectors to investigate — one per line<textarea rows={3} value={record.sectors.join('\n')} onChange={e => edit({ sectors: e.target.value.split('\n') })} placeholder="These are research leads, not established company exposure." /></label>
          <h3>Facts and citations</h3><p className="scope-note">Add one checkable claim per fact. Cite a PDF page or an HTML heading/paragraph. Keep possible economic effects out of the factual record.</p>
          {record.facts.map((f, i) => <fieldset className="review-fact" key={f.id}><legend>{f.id}</legend><label>Fact statement<textarea rows={3} maxLength={4000} value={f.statement} onChange={e => editFact(i, { statement: e.target.value })} /></label><label>Evidence source<select value={f.evidence_url} onChange={e => editFact(i, { evidence_url: e.target.value, page: null, location: '' })}><option value="">Choose evidence…</option>{evidence.map(a => <option key={a.url} value={a.url}>{a.title}</option>)}</select></label>{evidence.find(a => a.url === f.evidence_url)?.format === 'PDF' ? <label>PDF page number<input type="number" min={1} max={400} value={f.page ?? ''} onChange={e => editFact(i, { page: e.target.value ? Number(e.target.value) : null })} /></label> : <label>Heading or paragraph reference<input value={f.location} maxLength={300} onChange={e => editFact(i, { location: e.target.value })} placeholder="For example, Summary, paragraph 2" /></label>}
          {f.evidence_url && <a className="evidence-link" href={`${f.evidence_url}${f.page ? `#page=${f.page}` : ''}`} target="_blank" rel="noreferrer">Check original evidence ↗</a>}<button type="button" className="secondary" onClick={() => edit({ facts: record.facts.filter((_, index) => index !== i) })}>Remove {f.id}</button></fieldset>)}
          <button type="button" className="secondary" disabled={record.facts.length >= 30} onClick={() => { const used = new Set(record.facts.map(f => f.id)); const id = Array.from({ length: 99 }, (_, i) => `F${i + 1}`).find(v => !used.has(v))!; edit({ facts: [...record.facts, { id, statement: '', evidence_url: '', page: null, location: '' }] }); }}>Add a cited fact</button>
          <label>What to check next — one point per line<textarea rows={3} value={record.watchpoints.join('\n')} onChange={e => edit({ watchpoints: e.target.value.split('\n') })} /></label>
          <div className="review-actions"><button type="submit">Save private draft</button></div>
          <div className="publish-gate"><h3>Publish checked record</h3><p>Publishing makes this version visible to everyone on SIGNAL. Later edits remain private until you publish again.</p><label className="check-label"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I have checked each fact against the cited source, including any graphs, and verified the policy status and dates.</label><button type="button" disabled={!confirmed || stale || viewingDifferentVersion} onClick={() => act('publish')}>Publish checked record</button>{draft?.published_revision && <><a className="evidence-link" href={`/events/review-${draft.id}`} target="_blank" rel="noreferrer">View published record ↗</a><button className="secondary" type="button" onClick={() => act('unpublish')}>Unpublish record</button></>}</div>
          </fieldset>
        </form>
        {!!history.length && <details><summary>Review history</summary><ul>{history.map((h, i) => <li key={i}>{h.action} · version {h.revision} · {when(h.created_at)} (UK time)</li>)}</ul></details>}
      </div></div>}
    </>}
  </section>;
}
