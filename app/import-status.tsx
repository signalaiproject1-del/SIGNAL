import { importState, type getImportStatus } from '@/lib/import-status';
const when = (value: string) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' }).format(new Date(value));
export default function ImportStatus({ data }: { data: Awaited<ReturnType<typeof getImportStatus>> }) {
  const state = data.error ? 'unavailable' : importState(data.latest);
  const titles: Record<string, string> = { pending: 'First automatic refresh pending', success: 'Automatic refresh completed', partial: 'Some sources could not be refreshed', failed: 'Latest refresh failed', running: 'Refresh in progress', interrupted: 'Refresh needs attention', overdue: 'Source refresh is overdue', unavailable: 'Refresh status unavailable' };
  return <section className={`import-status ${state === 'success' ? '' : 'attention'}`} aria-label="Source refresh status">
    <div><p className="eyebrow">SOURCE COLLECTION</p><h2>{titles[state]}</h2><p>Daily refresh scheduled for 06:23 UTC. Start times can vary.</p>
      {data.latest?.finished_at && <p>Latest completed attempt: {when(data.latest.finished_at)} · {data.latest.imported_count} of {data.latest.expected_count} sources refreshed.</p>}
      {data.lastSuccess && <p>Last fully successful refresh: {when(data.lastSuccess.finished_at || data.lastSuccess.started_at)} (UK time).</p>}
      {!['success', 'pending', 'running'].includes(state) && <p>Previously collected evidence remains available. Check each source’s last successful check before using it.</p>}
      {data.latest && data.latest.failures.length > 0 && <details><summary>Sources needing attention ({data.latest.failures.length})</summary><ul>{data.latest.failures.map(f => <li key={f.source_url}><a href={f.source_url} target="_blank" rel="noreferrer">{f.source_url.split('/').at(-1)?.replaceAll('-', ' ')} ↗</a></li>)}</ul></details>}
    </div><a href="https://github.com/signalaiproject1-del/SIGNAL/actions/workflows/refresh-sources.yml" target="_blank" rel="noreferrer">Refresh history ↗</a>
  </section>;
}
