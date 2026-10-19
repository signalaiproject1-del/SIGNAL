import { checkDatabase } from '@/lib/health';
export const dynamic = 'force-dynamic';
export async function GET() {
  const database = await checkDatabase();
  return Response.json({ app: 'SIGNAL', database, checkedAt: new Date().toISOString() }, {
    status: database.ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' },
  });
}
