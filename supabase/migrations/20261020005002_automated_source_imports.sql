-- Curated public sources; ingestion is restricted to the server's verified GitHub workflow.
create table public.source_import_targets (source_url text primary key);
insert into public.source_import_targets select source_url from public.source_documents;
alter table public.source_import_targets enable row level security;
revoke all on public.source_import_targets from public, anon, authenticated;
grant select on public.source_import_targets to service_role;

create table public.source_import_runs (
  run_key text primary key check (run_key ~ '^[0-9]+-[0-9]+$'),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running','success','partial','failed')),
  expected_count integer not null,
  imported_count integer not null default 0,
  failures jsonb not null default '[]'::jsonb
);
alter table public.source_import_runs enable row level security;
revoke all on public.source_import_runs from public, anon, authenticated;
grant select on public.source_import_runs to anon, authenticated;
create policy "Read public import status" on public.source_import_runs
  for select to anon, authenticated using (true);
grant select, insert, update on public.source_import_runs to service_role;
grant select, insert, update on public.source_documents to service_role;
grant select, insert on public.source_versions to service_role;

create function public.record_source_import(p_run text, p_phase text, p_records jsonb default '[]', p_failures jsonb default '[]')
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  expected integer;
  current_run public.source_import_runs%rowtype;
  result_status text;
  entry jsonb;
begin
  if p_run !~ '^[0-9]+-[0-9]+$' then raise exception 'Invalid run'; end if;
  select count(*) into expected from public.source_import_targets;
  if p_phase = 'start' then
    insert into public.source_import_runs(run_key,status,expected_count) values(p_run,'running',expected)
    on conflict (run_key) do nothing;
    return jsonb_build_object('accepted',true,'run',p_run);
  end if;
  if p_phase <> 'finish' or jsonb_typeof(p_records) <> 'array' or jsonb_typeof(p_failures) <> 'array' then
    raise exception 'Invalid payload';
  end if;
  select * into strict current_run from public.source_import_runs where run_key=p_run for update;
  if current_run.finished_at is not null then return jsonb_build_object('status',current_run.status,'duplicate',true); end if;
  if jsonb_array_length(p_records)+jsonb_array_length(p_failures) <> expected then raise exception 'Incomplete results'; end if;
  if (select count(distinct item->>'source_url') from jsonb_array_elements(p_records || p_failures) item) <> expected then
    raise exception 'Duplicate source';
  end if;
  for entry in select value from jsonb_array_elements(p_records || p_failures) loop
    if not exists (select 1 from public.source_import_targets where source_url=entry->>'source_url') then raise exception 'Source not allowed'; end if;
  end loop;
  for entry in select value from jsonb_array_elements(p_records) loop
    if jsonb_typeof(entry->'content') is distinct from 'object'
      or jsonb_typeof(entry->'content'->'sections') is distinct from 'array'
      or jsonb_typeof(entry->'content'->'attachments') is distinct from 'array'
      or coalesce(length(entry->'content'->>'title'),0) = 0
      or coalesce(entry->>'content_hash','') !~ '^[a-f0-9]{64}$'
      or octet_length((entry->'content')::text) > 4000000 then raise exception 'Invalid content'; end if;
  end loop;
  for entry in select value from jsonb_array_elements(p_failures) loop
    if coalesce(entry->>'code','') not in ('source_not_allowed','download_failed','size_limit','invalid_pdf','encrypted_pdf','page_limit','pdf_extraction_failed','collection_failed')
      or (select count(*) from jsonb_object_keys(entry)) <> 2 then raise exception 'Invalid failure'; end if;
  end loop;
  insert into public.source_versions(source_url,content_hash,content,collected_at)
    select r->>'source_url',r->>'content_hash',r->'content',current_run.started_at from jsonb_array_elements(p_records) r
    on conflict (source_url,content_hash) do nothing;
  insert into public.source_documents(source_url,content_hash,content,collected_at,checked_at)
    select r->>'source_url',r->>'content_hash',r->'content',current_run.started_at,current_run.started_at from jsonb_array_elements(p_records) r
    on conflict (source_url) do update set content=excluded.content,content_hash=excluded.content_hash,checked_at=excluded.checked_at
      where public.source_documents.checked_at <= excluded.checked_at;
  result_status := case when jsonb_array_length(p_failures)=0 then 'success'
    when jsonb_array_length(p_records)=0 then 'failed' else 'partial' end;
  update public.source_import_runs set status=result_status,finished_at=now(),imported_count=jsonb_array_length(p_records),failures=p_failures
    where run_key=p_run;
  return jsonb_build_object('status',result_status,'imported',jsonb_array_length(p_records),'failed',jsonb_array_length(p_failures));
end;
$$;
revoke all on function public.record_source_import(text,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.record_source_import(text,text,jsonb,jsonb) to service_role;
