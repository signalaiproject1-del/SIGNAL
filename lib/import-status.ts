export type ImportRun = { run_key: string; started_at: string; finished_at: string | null; status: 'running' | 'success' | 'partial' | 'failed'; expected_count: number; imported_count: number; failures: { source_url: string; code: string }[]; discovery_failures?: { source_url: string; code: string }[]; discovered_count?: number; discovery_skipped?: number };
export async function getImportStatus(): Promise<{ latest: ImportRun | null; lastSuccess: ImportRun | null; error: boolean }> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return { latest: null, lastSuccess: null, error: true };
  try {
    const get = async (filter: string) => {
      const response = await fetch(`${url}/rest/v1/source_import_runs?select=*&order=started_at.desc&limit=1${filter}`, {
        headers: { apikey: key }, cache: 'no-store', signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error('Status unavailable');
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error('Invalid status');
      return (rows[0] || null) as ImportRun | null;
    };
    const [latest, lastSuccess] = await Promise.all([get(''), get('&status=eq.success')]);
    return { latest, lastSuccess, error: false };
  } catch { return { latest: null, lastSuccess: null, error: true }; }
}
export function importState(run: ImportRun | null, now = Date.now()) {
  if (!run) return 'pending';
  const age = now - Date.parse(run.started_at);
  if (run.status === 'running') return age > 30 * 60_000 ? 'interrupted' : 'running';
  if (age > 48 * 60 * 60_000) return 'overdue';
  return run.status;
}
