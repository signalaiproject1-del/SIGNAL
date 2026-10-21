'use client';
import { useState } from 'react';
import type { SourceContent } from '@/lib/sources';

export default function PdfPreview({ attachment }: { attachment: SourceContent['attachments'][number] }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const total = attachment.page_count || 1;
  const url = `${attachment.url.split('#')[0]}#page=${page}`;
  return <details className="pdf-preview" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>View PDF with graphs &amp; diagrams · {attachment.title}</summary>
    {open && <div>
      <p className="scope-note">Original PDF, including its images and layout. Graphs and diagrams have not been analysed by SIGNAL. This viewer loads the publisher’s current file; it may differ from the last imported version.</p>
      <div className="pdf-controls">
        <label>PDF page<input aria-label={`PDF page for ${attachment.title}`} type="number" min={1} max={total} value={page} onChange={event => setPage(Math.max(1, Math.min(total, Math.trunc(Number(event.target.value)) || 1)))} /></label>
        <span>of {total}</span>
        <a href={url} target="_blank" rel="noreferrer">Open original PDF ↗</a>
      </div>
      <object key={url} data={url} type="application/pdf" aria-label={`${attachment.title}, PDF page ${page}`} className="pdf-document">
        <p>Your browser cannot show this PDF here. <a href={url} target="_blank" rel="noreferrer">Open the original PDF ↗</a></p>
      </object>
      <p className="scope-note">Page navigation depends on your browser’s PDF viewer. Use its page controls if the selected page does not open.</p>
    </div>}
  </details>;
}
