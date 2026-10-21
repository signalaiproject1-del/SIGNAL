import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT } from '../supabase/functions/source-import/node_modules/jose/dist/webapi/index.js';
import { verifyWorkflowToken, ENDPOINT } from '../supabase/functions/source-import/auth.ts';
import { handleImport } from '../supabase/functions/source-import/handler.ts';
import { importState } from '../lib/import-status.ts';

const claims = {
  repository: 'signalaiproject1-del/SIGNAL', repository_id: '1424914596', repository_owner_id: '344551539',
  ref: 'refs/heads/main', workflow_ref: 'signalaiproject1-del/SIGNAL/.github/workflows/refresh-sources.yml@refs/heads/main',
  event_name: 'schedule', run_id: '12345', run_attempt: '1',
};
test('only correctly signed identities from the exact main-branch workflow are accepted', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const sign = (overrides = {}) => new SignJWT({ ...claims, ...overrides }).setProtectedHeader({ alg:'RS256' })
    .setIssuer('https://token.actions.githubusercontent.com').setAudience(ENDPOINT)
    .setSubject('repo:signalaiproject1-del@344551539/SIGNAL@1424914596:ref:refs/heads/main')
    .setIssuedAt().setNotBefore('0s').setExpirationTime('5m').sign(privateKey);
  assert.equal(await verifyWorkflowToken(await sign(), publicKey), '12345-1');
  for (const invalid of [{ref:'refs/heads/other'}, {repository_id:'999'}, {event_name:'pull_request'}, {workflow_ref:'untrusted'}, {repository_owner_id:'1'}]) {
    await assert.rejects(verifyWorkflowToken(await sign(invalid), publicKey));
  }
  const other = await generateKeyPair('RS256');
  await assert.rejects(verifyWorkflowToken(await sign(), other.publicKey));
});
test('unauthenticated calls and invalid payloads never reach the database', async () => {
  let calls = 0;
  const deps = { verify: async token => { if(token !== 'valid') throw Error(); return '12345-1'; }, save: async () => { calls++; return {accepted:true}; } };
  const request = (body, token='valid') => new Request(ENDPOINT,{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
  assert.equal((await handleImport(request({phase:'start'},'invalid'),deps)).status,401);
  assert.equal((await handleImport(request({phase:'delete'}),deps)).status,400);
  assert.equal((await handleImport(request({phase:'finish',records:{}}),deps)).status,400);
  assert.equal((await handleImport(request({phase:'start',records:{}}),deps)).status,400);
  assert.equal(calls,0);
  assert.equal((await handleImport(request({phase:'start'}),deps)).status,200);
  assert.equal(calls,1);
});
test('interrupted and overdue refreshes cannot appear healthy', () => {
  const now = Date.now();
  const run = {status:'running',started_at:new Date(now-31*60_000).toISOString()};
  assert.equal(importState(run,now),'interrupted');
  assert.equal(importState({...run,status:'success',started_at:new Date(now-49*3600_000).toISOString()},now),'overdue');
  assert.equal(importState(null,now),'pending');
});
