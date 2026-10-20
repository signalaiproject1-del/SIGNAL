import { createRemoteJWKSet, jwtVerify } from 'jose';

export const ENDPOINT = 'https://epegqqlcfnakppnmpmyy.supabase.co/functions/v1/source-import';
const ISSUER = 'https://token.actions.githubusercontent.com';
const REPO = 'signalaiproject1-del/SIGNAL';
const jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));

export async function verifyWorkflowToken(token: string, key: Parameters<typeof jwtVerify>[1] = jwks) {
  const { payload } = await jwtVerify(token, key, {
    issuer: ISSUER, audience: ENDPOINT, algorithms: ['RS256'], maxTokenAge: '10m',
    requiredClaims: ['exp', 'iat', 'nbf', 'sub', 'run_id', 'run_attempt'],
  });
  const subjects = [
    `repo:${REPO}:ref:refs/heads/main`,
    'repo:signalaiproject1-del@344551539/SIGNAL@1424914596:ref:refs/heads/main',
  ];
  if (payload.repository !== REPO || payload.repository_id !== '1424914596'
    || payload.repository_owner_id !== '344551539' || payload.ref !== 'refs/heads/main'
    || payload.workflow_ref !== `${REPO}/.github/workflows/refresh-sources.yml@refs/heads/main`
    || !['schedule', 'workflow_dispatch'].includes(String(payload.event_name))
    || !subjects.includes(String(payload.sub)) || !/^\d+$/.test(String(payload.run_id))
    || !/^\d+$/.test(String(payload.run_attempt))) throw new Error('Untrusted workflow');
  return `${payload.run_id}-${payload.run_attempt}`;
}
