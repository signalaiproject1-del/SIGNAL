export type Fact = { id: string; statement: string; page: number | null; evidence_url?: string; location?: string };
export type EventRecord = {
  slug: string; title: string; event_type: string; policy_area: string; jurisdiction: string;
  policy_status: string; event_date: string; source_updated_at: string; checked_at: string;
  source_url: string; document_url: string; document_sha256: string; deadline: string;
  summary: string; authorship: string; review_status: string;
  facts: Fact[]; targets: { year: string; percentage: number; status: string; page: number }[];
  watchpoints: string[];
  sectors?: string[]; source_hash?: string;
};
export type Impact = {
  id: string; sector: string; sector_name: string; mechanism: string; direction: string;
  horizon: string; explanation: string; fact_ids: string[]; confidence: string;
  confidence_reason: string; assumptions: string[]; countervailing: string; evidence_needed: string;
};
export type EventResult = { status: 'ok'; event: EventRecord; impacts: Impact[] } | { status: 'unavailable' | 'not_found' };
export async function getEvent(slug: string): Promise<EventResult> {
  if (!/^[a-z0-9-]{1,100}$/.test(slug)) return { status: 'not_found' };
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return { status: 'unavailable' };
  try {
    const query = new URLSearchParams({ select: 'record,event_sector_impacts(assessment)', slug: `eq.${slug}`, limit: '1' });
    const response = await fetch(`${url}/rest/v1/political_events?${query}`, {
      headers: { apikey: key }, cache: 'no-store', signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('Event unavailable');
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error('Invalid response');
    if (!rows.length) return { status: 'not_found' };
    const event: EventRecord = rows[0].record;
    if (!event || event.slug !== slug || !Array.isArray(event.facts) || !Array.isArray(event.targets) || !Array.isArray(rows[0].event_sector_impacts)) throw new Error('Invalid event');
    const impacts: Impact[] = rows[0].event_sector_impacts.map((i: { assessment: Impact }) => i.assessment);
    const facts = new Set(event.facts.map(f => f.id));
    if (impacts.some(i => !i || !Array.isArray(i.fact_ids) || !i.fact_ids.length || i.fact_ids.some(id => !facts.has(id)))) throw new Error('Broken evidence reference');
    return { status: 'ok', event, impacts: impacts.sort((a, b) => a.id.localeCompare(b.id)) };
  } catch { return { status: 'unavailable' }; }
}
export async function getPublishedReviews(): Promise<{ slug: string; title: string; event_date: string }[]> {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return [];
  try {
    const query = new URLSearchParams({ select: 'slug,title,event_date', slug: 'like.review-*', order: 'created_at.desc', limit: '30' });
    const response = await fetch(`${url}/rest/v1/political_events?${query}`, { headers: { apikey: key }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) return [];
    const rows = await response.json();
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}
