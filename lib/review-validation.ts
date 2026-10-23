export const EDITOR_EMAIL = 'signalaiproject1@gmail.com';
export const EVENT_TYPES = ['consultation', 'policy_announcement', 'legislation', 'statistics_release'] as const;
export const POLICY_STATUSES = ['proposal', 'announced', 'enacted', 'in_force', 'withdrawn'] as const;
export type ReviewFact = { id: string; statement: string; evidence_url: string; page: number | null; location: string };
export type ReviewRecord = {
  title: string; summary: string; event_type: string; policy_status: string; policy_area: string;
  jurisdiction: string; event_date: string; deadline: string; sectors: string[]; facts: ReviewFact[]; watchpoints: string[];
};
export type Draft = { id: string; source_url: string; source_hash: string; record: ReviewRecord; revision: number; published_revision: number | null; updated_at: string; published_at: string | null };
export function isEditor(user: { email?: string; email_confirmed_at?: string | null } | null) {
  return !!user?.email_confirmed_at && user.email?.toLowerCase() === EDITOR_EMAIL;
}
export function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function validateReview(value: unknown, publishing = false): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Invalid draft.';
  const r = value as ReviewRecord;
  for (const key of ['title','summary','event_type','policy_status','policy_area','jurisdiction','event_date','deadline'] as const) {
    if (typeof r[key] !== 'string' || r[key].length > (key === 'summary' ? 5000 : 300)) return `Please check ${key.replaceAll('_', ' ')}.`;
  }
  if (!Array.isArray(r.facts) || r.facts.length > 30 || !Array.isArray(r.sectors) || r.sectors.length > 20 || !Array.isArray(r.watchpoints) || r.watchpoints.length > 20) return 'Too many facts or notes.';
  if ([...r.sectors, ...r.watchpoints].some(v => typeof v !== 'string' || v.length > 2000)) return 'A note is too long.';
  for (const f of r.facts) {
    if (!f || typeof f !== 'object' || typeof f.statement !== 'string' || f.statement.length > 4000 || typeof f.evidence_url !== 'string' || f.evidence_url.length > 2000 || typeof f.location !== 'string' || f.location.length > 300 || typeof f.id !== 'string' || !/^F[1-9]\d?$/.test(f.id) || (f.page !== null && (!Number.isInteger(f.page) || f.page < 1 || f.page > 400))) return 'Please check the facts and page numbers.';
  }
  if (new Set(r.facts.map(f => f.id)).size !== r.facts.length) return 'Fact references must be unique.';
  if (r.event_date && !validDate(r.event_date) || r.deadline && !validDate(r.deadline)) return 'Enter a valid calendar date.';
  if (!publishing) return null;
  if (![r.title, r.summary, r.policy_area, r.jurisdiction].every(v => v.trim()) || !validDate(r.event_date)) return 'Add a title, summary, policy area, jurisdiction and event date before publishing.';
  if (!(EVENT_TYPES as readonly string[]).includes(r.event_type) || !(POLICY_STATUSES as readonly string[]).includes(r.policy_status)) return 'Choose the event type and policy status.';
  if (!r.facts.length || r.facts.some(f => !f.statement.trim() || !f.evidence_url || f.page === null && !f.location.trim())) return 'Every fact needs a statement and a PDF page or source heading.';
  return null;
}
