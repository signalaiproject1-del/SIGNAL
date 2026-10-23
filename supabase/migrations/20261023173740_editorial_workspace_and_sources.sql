-- Add independent official inputs without changing the import authentication boundary.
alter table public.source_documents add column last_changed_at timestamptz;
update public.source_documents set last_changed_at=collected_at;
alter table public.source_documents alter column last_changed_at set default now();
alter table public.source_documents alter column last_changed_at set not null;
insert into public.source_feeds values
('treasury-policy','HM Treasury policy papers and consultations',
'https://www.gov.uk/search/policy-papers-and-consultations?organisations%5B%5D=hm-treasury&parent=hm-treasury',
'https://www.gov.uk/search/policy-papers-and-consultations.atom?organisations%5B%5D=hm-treasury','hm-treasury',5),
('parliament-statements','UK Parliament written ministerial statements',
'https://questions-statements.parliament.uk/written-statements',
'https://questions-statements-api.parliament.uk/api/writtenstatements/statements?take=5','uk-parliament',5);
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
          or not exists(select 1 from public.source_feeds f where f.id=entry->>'feed_id' and ((f.organisation <> 'uk-parliament' and coalesce(entry->>'source_url','') ~ '^https://www[.]gov[.]uk/government/(publications|consultations)/[a-z0-9][a-z0-9-]*$') or (f.organisation = 'uk-parliament' and coalesce(entry->>'source_url','') ~ '^https://questions-statements[.]parliament[.]uk/written-statements/detail/[0-9]{4}-[0-9]{2}-[0-9]{2}/H[CL]WS[0-9]+$')))
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
        or (f.organisation='uk-parliament' and coalesce(entry->'content'->>'document_type','') <> 'ministerial_statement') or (f.organisation<>'uk-parliament' and coalesce(entry->'content'->>'document_type','') not in ('open_consultation','closed_consultation','consultation_outcome','policy_paper'))))
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
    on conflict (source_url) do update set content=excluded.content,content_hash=excluded.content_hash,checked_at=excluded.checked_at,
      last_changed_at=case when public.source_documents.content_hash <> excluded.content_hash then excluded.checked_at else public.source_documents.last_changed_at end
      where public.source_documents.checked_at <= excluded.checked_at;
  result_status := case when jsonb_array_length(p_failures)=0 and jsonb_array_length(current_run.discovery_failures)=0 then 'success'
    when jsonb_array_length(p_records)=0 then 'failed' else 'partial' end;
  update public.source_import_runs set status=result_status,finished_at=now(),imported_count=jsonb_array_length(p_records),failures=p_failures where run_key=p_run;
  return jsonb_build_object('status',result_status,'imported',jsonb_array_length(p_records),'failed',jsonb_array_length(p_failures));
end;
$$;
revoke all on function public.record_source_import(text,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.record_source_import(text,text,jsonb,jsonb) to service_role;

-- Editorial authorization is based on confirmed Auth identity, never user-editable metadata.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
create table private.editor_accounts (email text primary key);
insert into private.editor_accounts values ('signalaiproject1@gmail.com');
alter table private.editor_accounts enable row level security;
revoke all on private.editor_accounts from public, anon, authenticated;
create function private.is_editor() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.users u join private.editor_accounts e on lower(u.email)=e.email
    where u.id=(select auth.uid()) and u.email_confirmed_at is not null);
$$;
revoke all on function private.is_editor() from public, anon;
grant execute on function private.is_editor() to authenticated;
create function public.can_review() returns boolean language sql stable security invoker set search_path='' as $$ select private.is_editor(); $$;
revoke all on function public.can_review() from public, anon;
grant execute on function public.can_review() to authenticated;

grant select on public.source_versions to authenticated;
create policy "Editors read source history" on public.source_versions for select to authenticated using ((select private.is_editor()));

create table public.review_drafts (
  id uuid primary key default gen_random_uuid(),
  source_url text not null,
  source_hash text not null,
  record jsonb not null check (jsonb_typeof(record)='object' and octet_length(record::text)<=50000),
  revision integer not null default 1,
  published_revision integer,
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  foreign key (source_url,source_hash) references public.source_versions(source_url,content_hash)
);
create index review_drafts_source_idx on public.review_drafts(source_url,source_hash);
create table public.review_history (
  id bigint generated always as identity primary key,
  draft_id uuid not null references public.review_drafts(id),
  action text not null check (action in ('saved','published','unpublished')),
  revision integer not null,
  record jsonb not null,
  source_hash text not null,
  actor uuid not null,
  created_at timestamptz not null default now()
);
create index review_history_draft_idx on public.review_history(draft_id,created_at desc);
alter table public.review_drafts enable row level security;
alter table public.review_history enable row level security;
revoke all on public.review_drafts,public.review_history from public,anon,authenticated;
grant select on public.review_drafts,public.review_history to authenticated;
create policy "Editors read drafts" on public.review_drafts for select to authenticated using ((select private.is_editor()));
create policy "Editors read review history" on public.review_history for select to authenticated using ((select private.is_editor()));

-- Narrow privileged workflows are kept outside the exposed schema. Every entry checks identity.
-- Editors have no direct write grants, so revision checks, validation and audit cannot be skipped.
create function private.save_review_draft(p_id uuid,p_source_url text,p_record jsonb,p_revision integer,p_refresh_source boolean,p_source_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.review_drafts%rowtype; s public.source_documents%rowtype;
begin
  if not private.is_editor() then raise exception 'Editor access required' using errcode='42501'; end if;
  if jsonb_typeof(p_record) is distinct from 'object' or octet_length(p_record::text)>50000 then raise exception 'Invalid draft'; end if;
  select * into strict s from public.source_documents where source_url=p_source_url for share;
  if (p_id is null or p_refresh_source) and p_source_hash is distinct from s.content_hash then raise exception 'Source has changed. Reload the source before saving.'; end if;
  if p_id is null then
    insert into public.review_drafts(source_url,source_hash,record) values(p_source_url,s.content_hash,p_record) returning * into d;
  else
    select * into strict d from public.review_drafts where id=p_id for update;
    if d.revision is distinct from p_revision then raise exception 'Draft changed in another tab. Reload before saving.'; end if;
    if d.source_url<>p_source_url then raise exception 'Start a new draft to change its source.'; end if;
    update public.review_drafts set record=p_record,revision=revision+1,updated_at=now(),
      source_hash=case when p_refresh_source then s.content_hash else source_hash end
      where id=p_id returning * into d;
  end if;
  insert into public.review_history(draft_id,action,revision,record,source_hash,actor)
    values(d.id,'saved',d.revision,d.record,d.source_hash,auth.uid());
  return to_jsonb(d);
end $$;
revoke all on function private.save_review_draft(uuid,text,jsonb,integer,boolean,text) from public,anon;
grant execute on function private.save_review_draft(uuid,text,jsonb,integer,boolean,text) to authenticated;
create function public.save_review_draft(p_id uuid,p_source_url text,p_record jsonb,p_revision integer,p_refresh_source boolean default false,p_source_hash text default null)
returns jsonb language sql security invoker set search_path='' as $$ select private.save_review_draft(p_id,p_source_url,p_record,p_revision,p_refresh_source,p_source_hash); $$;
revoke all on function public.save_review_draft(uuid,text,jsonb,integer,boolean,text) from public,anon;
grant execute on function public.save_review_draft(uuid,text,jsonb,integer,boolean,text) to authenticated;

create function private.set_review_publication(p_id uuid,p_revision integer,p_publish boolean,p_confirm boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.review_drafts%rowtype; s public.source_documents%rowtype; r jsonb; f jsonb; a jsonb; k text; slug_value text; event_day date;
begin
  if not private.is_editor() then raise exception 'Editor access required' using errcode='42501'; end if;
  select * into strict d from public.review_drafts where id=p_id for update;
  if d.revision is distinct from p_revision then raise exception 'Draft changed in another tab. Reload before publishing.'; end if;
  slug_value := 'review-' || d.id::text;
  if p_publish then
    if p_confirm is distinct from true then raise exception 'Confirm that you checked the evidence.'; end if;
    select * into strict s from public.source_documents where source_url=d.source_url for share;
    if s.content_hash<>d.source_hash then raise exception 'Source has changed. Review the latest version before publishing.'; end if;
    r := d.record;
    foreach k in array array['title','summary','policy_area','jurisdiction','event_date'] loop
      if jsonb_typeof(r->k) is distinct from 'string' or coalesce(length(btrim(r->>k)),0)=0 then raise exception 'Complete all required event fields.'; end if;
    end loop;
    if length(r->>'title')>300 or length(r->>'summary')>5000
      or coalesce(r->>'event_type','') not in ('consultation','policy_announcement','legislation','statistics_release')
      or coalesce(r->>'policy_status','') not in ('proposal','announced','enacted','in_force','withdrawn') then raise exception 'Choose a valid event type and policy status.'; end if;
    if (r->>'event_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Invalid event date'; end if;
    event_day := (r->>'event_date')::date;
    if jsonb_typeof(r->'deadline') is distinct from 'string' then raise exception 'Invalid event date'; end if;
    if r->>'deadline'<>'' then
      if (r->>'deadline') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Invalid event date'; end if;
      perform (r->>'deadline')::date;
    end if;
    if jsonb_typeof(r->'facts') is distinct from 'array' then raise exception 'Add cited source facts.'; end if;
    if jsonb_array_length(r->'facts') not between 1 and 30 then raise exception 'Add between one and thirty facts.'; end if;
    if (select count(distinct x->>'id') from jsonb_array_elements(r->'facts') x) <> jsonb_array_length(r->'facts') then raise exception 'Fact IDs must be unique.'; end if;
    foreach k in array array['sectors','watchpoints'] loop
      if jsonb_typeof(r->k) is distinct from 'array' then raise exception 'Invalid notes'; end if;
      if jsonb_array_length(r->k)>20 or exists(select 1 from jsonb_array_elements(r->k) v where jsonb_typeof(v)<>'string' or length(v::text)>2002) then raise exception 'Invalid notes'; end if;
    end loop;
    for f in select value from jsonb_array_elements(r->'facts') loop
      if coalesce(f->>'id','') !~ '^F[1-9][0-9]?$' or jsonb_typeof(f->'statement') is distinct from 'string'
        or coalesce(length(btrim(f->>'statement')),0)=0 or length(f->>'statement')>4000
        or jsonb_typeof(f->'evidence_url') is distinct from 'string' or jsonb_typeof(f->'location') is distinct from 'string' or length(f->>'location')>300
        or coalesce(f->>'evidence_url','') !~ '^https://' then raise exception 'Every fact needs a statement and source.'; end if;
      if f->>'evidence_url'=d.source_url then
        if f->>'page' is not null or coalesce(length(btrim(f->>'location')),0)=0 then raise exception 'Cite the heading or paragraph on the source page.'; end if;
      else
        select value into a from jsonb_array_elements(s.content->'attachments') where value->>'url'=f->>'evidence_url' limit 1;
        if a is null then raise exception 'Evidence must be an attachment of the selected source.'; end if;
        if a->>'format'='PDF' then
          if jsonb_typeof(f->'page') is distinct from 'number' or coalesce(f->>'page','') !~ '^[1-9][0-9]{0,2}$' or (f->>'page')::integer > coalesce((a->>'page_count')::integer,0) then raise exception 'Choose a page within the cited PDF.'; end if;
        elsif a->>'format'='HTML' then
          if f->>'page' is not null or coalesce(length(btrim(f->>'location')),0)=0 then raise exception 'Cite a heading for HTML evidence.'; end if;
        else raise exception 'Use a PDF or HTML source for evidence.';
        end if;
      end if;
    end loop;
    r := r || jsonb_build_object('slug',slug_value,'source_url',d.source_url,'source_hash',d.source_hash,
      'source_updated_at',s.content->>'updated_at','checked_at',now(),'review_status','reviewed_by_editor',
      'authorship','Manually prepared and approved by the SIGNAL editor. This is not independent peer review.',
      'document_url','','document_sha256','','targets','[]'::jsonb);
    insert into public.political_events(slug,title,event_type,policy_area,jurisdiction,policy_status,event_date,source_url,record)
      values(slug_value,r->>'title',r->>'event_type',r->>'policy_area',r->>'jurisdiction',r->>'policy_status',event_day,d.source_url,r)
      on conflict (slug) do update set title=excluded.title,event_type=excluded.event_type,policy_area=excluded.policy_area,
      jurisdiction=excluded.jurisdiction,policy_status=excluded.policy_status,event_date=excluded.event_date,record=excluded.record;
    update public.review_drafts set published_revision=revision,published_at=now() where id=d.id returning * into d;
  else
    delete from public.political_events where slug=slug_value;
    update public.review_drafts set published_revision=null,published_at=null where id=d.id returning * into d;
  end if;
  insert into public.review_history(draft_id,action,revision,record,source_hash,actor)
    values(d.id,case when p_publish then 'published' else 'unpublished' end,d.revision,d.record,d.source_hash,auth.uid());
  return to_jsonb(d);
end $$;
revoke all on function private.set_review_publication(uuid,integer,boolean,boolean) from public,anon;
grant execute on function private.set_review_publication(uuid,integer,boolean,boolean) to authenticated;
create function public.set_review_publication(p_id uuid,p_revision integer,p_publish boolean,p_confirm boolean default false)
returns jsonb language sql security invoker set search_path='' as $$ select private.set_review_publication(p_id,p_revision,p_publish,p_confirm); $$;
revoke all on function public.set_review_publication(uuid,integer,boolean,boolean) from public,anon;
grant execute on function public.set_review_publication(uuid,integer,boolean,boolean) to authenticated;
