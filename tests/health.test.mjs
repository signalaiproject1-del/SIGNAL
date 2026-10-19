import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDatabase } from '../lib/health.ts';

test('database probe reports real connectivity and handles failures', async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  try {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    assert.deepEqual(await checkDatabase(), { ok: false, status: 'not_configured' });
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'test-public-key';
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://example.supabase.co/rest/v1/rpc/signal_health');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.apikey, 'test-public-key');
      assert.equal(options.cache, 'no-store');
      return Response.json({ project: 'SIGNAL', status: 'ok' });
    };
    assert.deepEqual(await checkDatabase(), { ok: true, status: 'connected' });
    globalThis.fetch = async () => Response.json({ project: 'OTHER', status: 'ok' });
    assert.equal((await checkDatabase()).ok, false);
    globalThis.fetch = async () => new Response('', { status: 403 });
    assert.deepEqual(await checkDatabase(), { ok: false, status: 'unavailable' });
    globalThis.fetch = async () => { throw new Error('network unavailable'); };
    assert.deepEqual(await checkDatabase(), { ok: false, status: 'unavailable' });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY; else process.env.SUPABASE_PUBLISHABLE_KEY = originalKey;
  }
});
