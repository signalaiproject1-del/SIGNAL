export async function checkDatabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return { ok: false, status: 'not_configured' };
  try {
    const response = await fetch(`${url}/rest/v1/rpc/signal_health`, {
      method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' },
      body: '{}', cache: 'no-store', signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return { ok: false, status: 'unavailable' };
    const data = await response.json();
    const ok = data?.project === 'SIGNAL' && data?.status === 'ok';
    return { ok, status: ok ? 'connected' : 'unexpected_response' };
  } catch { return { ok: false, status: 'unavailable' }; }
}
