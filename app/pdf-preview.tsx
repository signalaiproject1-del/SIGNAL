'use client';
import { useState } from 'react';
import type { SourceContent } from '@/lib/sources';

export default function PdfPreview({ attachment }: { attachment: SourceContent['attachments'][number] }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const total = attachment.page_count || 1;
  const url = `${attachment.url.split('#')[0]}#page=${page}`;
  return <details className="pdf-preview" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Inspect graphs &amp; diagrams in the original PDF · {attachment.title}</summary>
    {open && <div>
      <p className="scope-note">Open the original PDF to see its images and layout. GOV.UK does not allow these PDFs to be embedded here. Graphs and diagrams have not been analysed by SIGNAL. The publisher’s current file may differ from the last imported version.</p>
      <div className="pdf-controls">
        <label>PDF page<input aria-label={`PDF page for ${attachment.title}`} type="number" min={1} max={total} value={page} onChange={event => setPage(Math.max(1, Math.min(total, Math.trunc(Number(event.target.value)) || 1)))} /></label>
        <span>of {total}</span>
        <a href={url} target="_blank" rel="noreferrer">Open original PDF ↗</a>
      </div>
      <p className="scope-note">The link requests PDF page {page}. Page navigation depends on your browser’s viewer; use its page controls if the requested page does not open.</p>
    </div>}
  </details>;
}
