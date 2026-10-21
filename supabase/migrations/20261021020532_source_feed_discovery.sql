-- Public feed descriptions; discovery/import writes retain verified workflow-only access.
create table public.source_feeds (
  id text primary key,
  name text not null,
  url text not null unique,
  atom_url text not null,
  organisation text not null,
  per_run_limit integer not null check (per_run_limit between 1 and 10)
);
insert into public.source_feeds values (
  'desnz-policy', 'DESNZ policy papers and consultations',
  'https://www.gov.uk/search/policy-papers-and-consultations?organisations%5B%5D=department-for-energy-security-and-net-zero&parent=department-for-energy-security-and-net-zero',
  'https://www.gov.uk/search/policy-papers-and-consultations.atom?organisations%5B%5D=department-for-energy-security-and-net-zero',
  'department-for-energy-security-and-net-zero', 5
);
alter table public.source_feeds enable row level security;
revoke all on public.source_feeds from public, anon, authenticated;
grant select on public.source_feeds to anon, authenticated, service_role;
create policy "Read configured public feeds" on public.source_feeds for select to anon, authenticated using (true);

alter table public.source_import_targets add column feed_id text references public.source_feeds(id);
create index source_import_targets_feed_idx on public.source_import_targets(feed_id);
grant insert on public.source_import_targets to service_role;
alter table public.source_import_runs
  add column target_urls text[],
  add column discovery_failures jsonb not null default '[]'::jsonb,
  add column discovered_count integer not null default 0,
  add column discovery_skipped integer not null default 0;

create or replace function public.record_source_import(p_run text, p_phase text, p_records jsonb default '[]', p_failures jsonb default '[]')
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  current_run public.source_import_runs%rowtype;
  approved text[];
  entry jsonb;
  result_status text;
  added integer := 0;
  skipped integer := 0;
begin
  if coalesce(p_run,'') !~ '^[0-9]+-[0-9]+$'
    or jsonb_typeof(p_records) is distinct from 'array'
    or jsonb_typeof(p_failures) is distinct from 'array' then raise exception 'Invalid payload'; end if;
  -- Registration and each run's target snapshot are atomic, even for overlapping runs.
  perform pg_advisory_xact_lock(20261021, 1);
  if p_phase = 'start' then
    select * into current_run from public.source_import_runs where run_key=p_run for update;
    if not found then
      for entry in select value from jsonb_array_elements(p_records) loop
        if (select count(*) from jsonb_object_keys(entry)) <> 2
          or coalesce(entry->>'source_url','') !~ '^https://www[.]gov[.]uk/government/(publications|consultations)/[a-z0-9][a-z0-9-]*$'
          or not exists(select 1 from public.source_feeds f where f.id=entry->>'feed_id'
            and (select count(*) from jsonb_array_elements(p_records) c where c->>'feed_id'=f.id) <= f.per_run_limit)
          then raise exception 'Discovery target not allowed'; end if;
      end loop;
      for entry in select value from jsonb_array_elements(p_failures) loop
        if not exists(select 1 from public.source_feeds where url=entry->>'source_url')
          or coalesce(entry->>'code','') not in ('download_failed','size_limit','source_not_allowed','invalid_feed')
          or (select count(*) from jsonb_object_keys(entry)) <> 2 then raise exception 'Invalid discovery failure'; end if;
      end loop;
      for entry in select value from jsonb_array_elements(p_records) loop
        if not exists(select 1 from public.source_import_targets where source_url=entry->>'source_url') then
          if (select count(*) from public.source_import_targets) < 100 then
            insert into public.source_import_targets(source_url,feed_id) values(entry->>'source_url',entry->>'feed_id');
            added := added + 1;
          else skipped := skipped + 1;
          end if;
        end if;
      end loop;
      select array_agg(source_url order by source_url) into approved from public.source_import_targets;
      insert into public.source_import_runs(run_key,status,expected_count,target_urls,discovery_failures,discovered_count,discovery_skipped)
        values(p_run,'running',coalesce(cardinality(approved),0),approved,p_failures,added,skipped)
        returning * into current_run;
    end if;
    return jsonb_build_object('accepted',true,'run',p_run,
      'discovered_count',current_run.discovered_count,'discovery_skipped',current_run.discovery_skipped,
      'targets',(select coalesce(jsonb_agg(jsonb_build_object('source_url',t.source_url,'organisation',f.organisation) order by t.source_url),'[]'::jsonb)
        from public.source_import_targets t left join public.source_feeds f on f.id=t.feed_id
        where t.source_url=any(coalesce(current_run.target_urls,array(select source_url from public.source_import_targets)))));
  end if;
  if p_phase <> 'finish' then raise exception 'Invalid phase'; end if;
  select * into strict current_run from public.source_import_runs where run_key=p_run for update;
  if current_run.finished_at is not null then return jsonb_build_object('status',current_run.status,'duplicate',true); end if;
  approved := coalesce(current_run.target_urls,array(select source_url from public.source_import_targets));
  if jsonb_array_length(p_records)+jsonb_array_length(p_failures) <> current_run.expected_count then raise exception 'Incomplete results'; end if;
  if (select count(distinct item->>'source_url') from jsonb_array_elements(p_records || p_failures) item) <> current_run.expected_count then
    raise exception 'Duplicate source'; end if;
  for entry in select value from jsonb_array_elements(p_records || p_failures) loop
    if coalesce(entry->>'source_url','') <> all(approved) then raise exception 'Source not allowed'; end if;
  end loop;
  for entry in select value from jsonb_array_elements(p_records) loop
    if jsonb_typeof(entry->'content') is distinct from 'object'
      or jsonb_typeof(entry->'content'->'sections') is distinct from 'array'
      or jsonb_typeof(entry->'content'->'attachments') is distinct from 'array'
      or coalesce(length(entry->'content'->>'title'),0) = 0
      or coalesce(entry->>'content_hash','') !~ '^[a-f0-9]{64}$'
      or octet_length((entry->'content')::text) > 4000000 then raise exception 'Invalid content'; end if;
    if exists(select 1 from public.source_import_targets t join public.source_feeds f on f.id=t.feed_id
      where t.source_url=entry->>'source_url'
      and (not coalesce(entry->'content'->'organisation_slugs' ? f.organisation,false)
        or coalesce(entry->'content'->>'document_type','') not in ('open_consultation','closed_consultation','consultation_outcome','policy_paper')))
      then raise exception 'Wrong publisher or publication type'; end if;
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
  result_status := case when jsonb_array_length(p_failures)=0 and jsonb_array_length(current_run.discovery_failures)=0 then 'success'
    when jsonb_array_length(p_records)=0 then 'failed' else 'partial' end;
  update public.source_import_runs set status=result_status,finished_at=now(),imported_count=jsonb_array_length(p_records),failures=p_failures where run_key=p_run;
  return jsonb_build_object('status',result_status,'imported',jsonb_array_length(p_records),'failed',jsonb_array_length(p_failures));
end;
$$;
revoke all on function public.record_source_import(text,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.record_source_import(text,text,jsonb,jsonb) to service_role;
