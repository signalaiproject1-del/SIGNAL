import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { isEditor } from './review-validation';

export async function reviewClient() {
  const jar = await cookies();
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Sign-in is not configured.');
  return createServerClient(url, key, {
    cookieOptions: { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' },
    cookies: { getAll: () => jar.getAll(), setAll: values => values.forEach(({ name, value, options }) => jar.set(name, value, options)) },
  });
}
export async function editorClient() {
  const db = await reviewClient();
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !isEditor(user)) return null;
  const access = await db.rpc('can_review');
  return !access.error && access.data === true ? db : null;
}
export function sameOrigin(request: Request) {
  return request.headers.get('origin') === new URL(request.url).origin;
}
export const privateHeaders = { 'Cache-Control': 'private, no-store', 'Pragma': 'no-cache', 'X-Robots-Tag': 'noindex' };
