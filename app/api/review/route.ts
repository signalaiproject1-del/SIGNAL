import { editorClient, sameOrigin, privateHeaders } from '@/lib/review-server';
import { validateReview } from '@/lib/review-validation';
import { getImportStatus } from '@/lib/import-status';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: privateHeaders });
export async function GET(request: Request) {
  try {
    const db = await editorClient();
    if (!db) return reply({ error: 'Sign in with the approved editor account.' }, 401);
    const params = new URL(request.url).searchParams;
    const id = params.get('id'), sourceUrl = params.get('source');
    if (id) {
      if (!/^[0-9a-f-]{36}$/.test(id)) return reply({ error: 'Invalid draft.' }, 400);
      const [draft, history] = await Promise.all([
        db.from('review_drafts').select('*').eq('id', id).single(),
        db.from('review_history').select('action,revision,created_at').eq('draft_id', id).order('created_at', { ascending: false }).limit(20),
      ]);
      if (draft.error || history.error) throw new Error('Draft unavailable');
      return reply({ draft: draft.data, history: history.data });
    }
    if (sourceUrl) {
      const [source, versions] = await Promise.all([
        db.from('source_documents').select('*').eq('source_url', sourceUrl).single(),
        db.from('source_versions').select('content_hash,collected_at').eq('source_url', sourceUrl).order('collected_at', { ascending: false }).limit(30),
      ]);
      if (source.error || versions.error) throw new Error('Source unavailable');
      const hash = params.get('version');
      let snapshot = null;
      if (hash && /^[a-f0-9]{64}$/.test(hash)) {
        const past = await db.from('source_versions').select('content,content_hash,collected_at').eq('source_url', sourceUrl).eq('content_hash', hash).single();
        if (past.error) throw new Error('Version unavailable');
        snapshot = past.data;
      }
      return reply({ source: source.data, versions: versions.data, snapshot });
    }
    const [sources, drafts, imports] = await Promise.all([
      db.from('source_documents').select('source_url,content_hash,checked_at,last_changed_at,title:content->>title,publisher:content->>publisher').order('last_changed_at', { ascending: false }).limit(100),
      db.from('review_drafts').select('id,source_url,source_hash,revision,published_revision,updated_at,published_at,title:record->>title').order('updated_at', { ascending: false }).limit(100),
      getImportStatus(),
    ]);
    if (sources.error || drafts.error) throw new Error('Workspace unavailable');
    return reply({ sources: sources.data, drafts: drafts.data, imports });
  } catch { return reply({ error: 'The review workspace could not be loaded. Please retry.' }, 503); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: 'Request not allowed.' }, 403);
  try {
    const db = await editorClient();
    if (!db) return reply({ error: 'Your session has expired. Sign in again before saving.' }, 401);
    const body = await request.text();
    if (body.length > 50000) return reply({ error: 'This draft is too large.' }, 413);
    const input = JSON.parse(body);
    if (!['save', 'publish', 'unpublish'].includes(input.action)) return reply({ error: 'Invalid action.' }, 400);
    if (input.id !== null && (typeof input.id !== 'string' || !/^[0-9a-f-]{36}$/.test(input.id))) return reply({ error: 'Invalid draft.' }, 400);
    if (!Number.isInteger(input.revision) || input.revision < 0) return reply({ error: 'Invalid draft version.' }, 400);
    if (input.action === 'save') {
      const error = validateReview(input.record);
      if (error || typeof input.source_url !== 'string' || !/^[a-f0-9]{64}$/.test(input.source_hash || '')) return reply({ error: error || 'Choose a source.' }, 400);
      const saved = await db.rpc('save_review_draft', { p_id: input.id, p_source_url: input.source_url, p_record: input.record, p_revision: input.revision, p_refresh_source: input.refresh_source === true, p_source_hash: input.source_hash });
      if (saved.error) return reply({ error: safeDatabaseError(saved.error.message) }, 409);
      return reply({ draft: saved.data });
    }
    const result = await db.rpc('set_review_publication', { p_id: input.id, p_revision: input.revision, p_publish: input.action === 'publish', p_confirm: input.confirm === true });
    if (result.error) return reply({ error: safeDatabaseError(result.error.message) }, 409);
    return reply({ draft: result.data });
  } catch { return reply({ error: 'Your changes were not saved. Please try again.' }, 503); }
}
function safeDatabaseError(message: string) {
  const approved = ['Draft changed', 'Source has changed', 'Complete all', 'Choose a', 'Every fact', 'Evidence must', 'Cite ', 'Use a PDF', 'Confirm that', 'Add between', 'Add cited', 'Start a new draft', 'Fact IDs', 'Invalid event date'];
  return approved.some(prefix => message.startsWith(prefix)) ? message : 'Unable to save this record. Check the required fields and evidence references.';
}
