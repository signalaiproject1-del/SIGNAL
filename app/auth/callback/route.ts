import { NextResponse } from 'next/server';
import { reviewClient, privateHeaders } from '@/lib/review-server';
import { isEditor } from '@/lib/review-validation';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = process.env.NODE_ENV === 'production' ? 'https://signal-murex-zeta.vercel.app' : url.origin;
  let success = false;
  try {
    const code = url.searchParams.get('code');
    if (code && code.length < 500) {
      const db = await reviewClient();
      const { data, error } = await db.auth.exchangeCodeForSession(code);
      success = !error && isEditor(data.user);
      if (!success) await db.auth.signOut({ scope: 'local' });
    }
  } catch { /* A fresh sign-in link recovers expired or browser-mismatched codes. */ }
  return NextResponse.redirect(new URL(success ? '/review' : '/review?signin=failed', origin), { headers: privateHeaders });
}
