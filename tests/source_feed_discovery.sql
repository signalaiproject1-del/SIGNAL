-- Integration checks against the migrated database. All test writes roll back.
begin;
set local role service_role;
do $$
declare a jsonb; b jsonb; payload jsonb; failures jsonb; before_count int;
begin
  select count(*) into before_count from public.source_documents;
  a := public.record_source_import('99999990001-1','start',
    '[{"source_url":"https://www.gov.uk/government/publications/signal-test-one","feed_id":"desnz-policy"}]');
  b := public.record_source_import('99999990002-1','start',
    '[{"source_url":"https://www.gov.uk/government/publications/signal-test-two","feed_id":"desnz-policy"}]');
  if jsonb_array_length(b->'targets') <> jsonb_array_length(a->'targets')+1 then raise exception 'Snapshot isolation failed'; end if;
  if public.record_source_import('99999990001-1','start')->'targets' <> a->'targets' then raise exception 'Retry changed target snapshot'; end if;
  begin
    perform public.record_source_import('99999990003-1','start','[{"source_url":"https://evil.example/a","feed_id":"desnz-policy"}]');
    raise exception 'Unexpected acceptance';
  exception when others then
    if sqlerrm = 'Unexpected acceptance' then raise; end if;
  end;
  select jsonb_agg(jsonb_build_object('source_url',t->>'source_url','code','download_failed')) into failures
    from jsonb_array_elements(a->'targets') t;
  b := public.record_source_import('99999990001-1','finish','[]',failures);
  if b->>'status' <> 'failed' or (select count(*) from public.source_documents) <> before_count then raise exception 'Failed refresh changed library'; end if;
  if public.record_source_import('99999990001-1','finish','[]','[]')->>'duplicate' <> 'true' then raise exception 'Retry not idempotent'; end if;
  -- A feed outage still allows every previously approved source to refresh.
  select public.record_source_import('99999990004-1','start','[]',jsonb_build_array(jsonb_build_object('source_url',url,'code','download_failed')))
    into a from public.source_feeds where id='desnz-policy';
  select jsonb_agg(jsonb_build_object('source_url',t->>'source_url','content_hash',repeat('f',64),
    'content',jsonb_build_object('title','Rollback-only fixture','document_type',case when t->>'organisation'='uk-parliament' then 'ministerial_statement' else 'policy_paper' end,'sections','[]'::jsonb,'attachments','[]'::jsonb,
      'organisation_slugs',jsonb_build_array(coalesce(t->>'organisation','department-for-energy-security-and-net-zero')))))
    into payload from jsonb_array_elements(a->'targets') t;
  b := public.record_source_import('99999990004-1','finish',payload,'[]');
  if b->>'status' <> 'partial' then raise exception 'Feed outage looked healthy'; end if;
  if (select count(*) from public.source_documents) <> before_count+2 then raise exception 'Successful documents not imported'; end if;
end $$;
reset role;
do $$ begin
  if has_function_privilege('anon','public.record_source_import(text,text,jsonb,jsonb)','execute')
    or has_function_privilege('authenticated','public.record_source_import(text,text,jsonb,jsonb)','execute')
    or has_table_privilege('anon','public.source_feeds','insert')
    or not has_table_privilege('anon','public.source_feeds','select')
    or not (select relrowsecurity from pg_class where oid='public.source_feeds'::regclass)
    then raise exception 'Public access boundary failed'; end if;
end $$;
rollback;
