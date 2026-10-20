import { verifyWorkflowToken } from './auth.ts';
import { handleImport } from './handler.ts';

Deno.serve((request: Request) => handleImport(request, {
  verify: verifyWorkflowToken,
  save: async (run, phase, records, failures) => {
    const named = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
    const key = named.default || Deno.env.get('SUPABASE_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!key) throw new Error('Server configuration missing');
    const headers: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' };
    if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
    const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/record_source_import`, {
      method: 'POST', headers,
      body: JSON.stringify({ p_run: run, p_phase: phase, p_records: records, p_failures: failures }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) { console.error('Import RPC rejected', response.status); throw new Error('Database rejected import'); }
    return response.json();
  },
}));
