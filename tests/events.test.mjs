import test from 'node:test';
import assert from 'node:assert/strict';
import { getEvent } from '../lib/events.ts';
test('event lookup distinguishes unknown records, outages and broken evidence', async () => {
 const before = { fetch: globalThis.fetch, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_PUBLISHABLE_KEY };
 try {
  process.env.SUPABASE_URL='https://example.supabase.co'; process.env.SUPABASE_PUBLISHABLE_KEY='test';
  globalThis.fetch=async()=>{throw new Error('invalid slugs must not fetch');};
  assert.equal((await getEvent('bad&slug')).status,'not_found');
  globalThis.fetch=async(url,options)=>{assert.equal(options.method,undefined);assert.equal(new URL(url).searchParams.get('slug'),'eq.clean-heat-2027');return Response.json([]);};
  assert.equal((await getEvent('clean-heat-2027')).status,'not_found');
  globalThis.fetch=async()=>new Response('',{status:503});
  assert.equal((await getEvent('clean-heat-2027')).status,'unavailable');
  const record={slug:'clean-heat-2027',facts:[{id:'F1'}],targets:[],policy_status:'proposal'};
  globalThis.fetch=async()=>Response.json([{record,event_sector_impacts:[{assessment:{id:'one',fact_ids:['F2']}}]}]);
  assert.equal((await getEvent('clean-heat-2027')).status,'unavailable');
  globalThis.fetch=async()=>Response.json([{record,event_sector_impacts:[{assessment:{id:'one',fact_ids:['F1']}}]}]);
  const result=await getEvent('clean-heat-2027');
  assert.equal(result.status,'ok');assert.equal(result.event.policy_status,'proposal');assert.equal(result.impacts.length,1);
  delete process.env.SUPABASE_URL; assert.equal((await getEvent('clean-heat-2027')).status,'unavailable');
 } finally {
  globalThis.fetch=before.fetch;
  if(before.url===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=before.url;
  if(before.key===undefined)delete process.env.SUPABASE_PUBLISHABLE_KEY;else process.env.SUPABASE_PUBLISHABLE_KEY=before.key;
 }
});
