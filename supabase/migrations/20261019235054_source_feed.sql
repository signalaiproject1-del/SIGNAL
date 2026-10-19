-- Public official-source material only. Writes remain administrator-only.
create table public.source_documents (
  source_url text primary key,
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  content_hash text not null,
  collected_at timestamptz not null default now(),
  checked_at timestamptz not null default now()
);
alter table public.source_documents enable row level security;
revoke all on public.source_documents from anon, authenticated;
grant select on public.source_documents to anon, authenticated;
create policy "Read public official sources" on public.source_documents
  for select to anon, authenticated using (true);

-- Archive each distinct captured version. No public access to the archive.
create table public.source_versions (
  source_url text not null,
  content_hash text not null,
  content jsonb not null,
  collected_at timestamptz not null default now(),
  primary key (source_url, content_hash)
);
alter table public.source_versions enable row level security;
revoke all on public.source_versions from anon, authenticated;
