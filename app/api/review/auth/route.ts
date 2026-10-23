import { reviewClient, sameOrigin, privateHeaders } from '@/lib/review-server';
import { EDITOR_EMAIL } from '@/lib/review-validation';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Request not allowed.' }, { status: 403, headers: privateHeaders });
  try {
    const body = await request.text();
    if (body.length > 2000) throw new Error('Invalid request.');
    const input = JSON.parse(body);
    const db = await reviewClient();
    if (input.action === 'logout') {
      const { error } = await db.auth.signOut({ scope: 'local' });
      if (error) throw new Error('Sign-out failed. Please try again.');
      return Response.json({ ok: true }, { headers: privateHeaders });
    }
    if (typeof input.email !== 'string' || input.email.trim().toLowerCase() !== EDITOR_EMAIL) {
      return Response.json({ error: 'Use the approved SIGNAL editor email.' }, { status: 403, headers: privateHeaders });
    }
    const origin = process.env.NODE_ENV === 'production' ? 'https://signal-murex-zeta.vercel.app' : new URL(request.url).origin;
    const { error } = await db.auth.signInWithOtp({ email: EDITOR_EMAIL, options: { emailRedirectTo: `${origin}/auth/callback` } });
    if (error) return Response.json({ error: 'The sign-in email could not be sent. Wait a minute before trying again. If it persists, check Supabase email delivery.' }, { status: 503, headers: privateHeaders });
    return Response.json({ ok: true }, { headers: privateHeaders });
  } catch { return Response.json({ error: 'Sign-in is temporarily unavailable. Please try again.' }, { status: 503, headers: privateHeaders }); }
}
