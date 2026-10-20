export type SourceContent = {
  source_id: string; title: string; description: string; document_type: string;
  publisher: string; published_at: string | null; updated_at: string | null;
  closing_at: string | null; release_at: string | null; withdrawn: boolean;
  coverage: string; change_history: { note: string; public_timestamp: string }[];
  sections: { title: string; url: string; text: string; format?: string; page?: number }[];
  attachments: { title: string; url: string; format: string; extraction_status?: string; text_pages?: number; page_count?: number; pages_without_text?: number[]; sha256?: string }[];
};
export type Source = { source_url: string; content: SourceContent; collected_at: string; checked_at: string };
export async function getSources(): Promise<{ sources: Source[]; error: boolean }> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return { sources: [], error: true };
  try {
    const response = await fetch(`${url}/rest/v1/source_documents?select=source_url,content,collected_at,checked_at&order=source_url&limit=100`, {
      headers: { apikey: key }, cache: 'no-store', signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('Source feed unavailable');
    const sources: Source[] = await response.json();
    if (!Array.isArray(sources)) throw new Error('Invalid source response');
    return { sources, error: false };
  } catch { return { sources: [], error: true }; }
}
