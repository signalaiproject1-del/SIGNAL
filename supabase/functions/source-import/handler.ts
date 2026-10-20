type Dependencies = {
  verify: (token: string) => Promise<string>;
  save: (run: string, phase: string, records: unknown[], failures: unknown[]) => Promise<unknown>;
};
const MAX_BODY = 10 * 1024 * 1024;
export async function handleImport(request: Request, dependencies: Dependencies): Promise<Response> {
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  let run: string;
  try {
    const authorization = request.headers.get('Authorization') || '';
    if (!authorization.startsWith('Bearer ')) throw new Error('No identity');
    run = await dependencies.verify(authorization.slice(7));
  } catch { return reply({ error: 'Unauthorized workflow' }, 401); }
  let body;
  try {
    if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return reply({ error: 'Payload too large' }, 413);
    const reader = request.body?.getReader();
    if (!reader) throw new Error('No body');
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); return reply({ error: 'Payload too large' }, 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    body = JSON.parse(new TextDecoder().decode(bytes));
    if (!['start', 'finish'].includes(body.phase)) throw new Error('Invalid phase');
    if (body.phase === 'finish' && (!Array.isArray(body.records) || !Array.isArray(body.failures))) throw new Error('Invalid results');
  } catch { return reply({ error: 'Invalid import payload' }, 400); }
  try {
    return reply(await dependencies.save(run, body.phase, body.records || [], body.failures || []));
  } catch { return reply({ error: 'Import could not be saved; previous data retained' }, 502); }
}
