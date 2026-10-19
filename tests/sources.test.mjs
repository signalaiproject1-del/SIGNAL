import test from 'node:test';
import assert from 'node:assert/strict';
import { getSources } from '../lib/sources.ts';
test('source feed distinguishes outages from empty results and uses read-only requests', async () => {
  const oldFetch = globalThis.fetch;
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  try {
    delete process.env.SUPABASE_URL;
    assert.deepEqual(await getSources(), { sources: [], error: true });
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'test';
    globalThis.fetch = async (url, options) => {
      assert.match(url, /\/rest\/v1\/source_documents\?/);
      assert.equal(options.method, undefined);
      assert.equal(options.cache, 'no-store');
      return Response.json([]);
    };
    assert.deepEqual(await getSources(), { sources: [], error: false });
    globalThis.fetch = async () => new Response('', { status: 403 });
    assert.deepEqual(await getSources(), { sources: [], error: true });
    globalThis.fetch = async () => { throw new Error('offline'); };
    assert.deepEqual(await getSources(), { sources: [], error: true });
    globalThis.fetch = async () => Response.json({ error: 'bad response' });
    assert.deepEqual(await getSources(), { sources: [], error: true });
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY; else process.env.SUPABASE_PUBLISHABLE_KEY = oldKey;
  }
});
