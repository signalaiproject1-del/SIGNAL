-- Run after the migration. All fixture identities, drafts and publications roll back.
begin;
insert into auth.users(id,email,email_confirmed_at) values
('00000000-0000-4000-8000-000000000001','signalaiproject1@gmail.com',now()),
('00000000-0000-4000-8000-000000000002','signal-test-outsider@example.invalid',now());
set local request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local role authenticated;
do $$
declare d jsonb; r jsonb; url text; first_title text; source_hash text;
begin
  if not public.can_review() then raise exception 'Editor denied'; end if;
  select source_url,content_hash into url,source_hash from public.source_documents order by source_url limit 1;
  r := jsonb_build_object('title','Rollback-only review fixture','summary','A checked test statement.',
    'event_type','policy_announcement','policy_status','announced','policy_area','Testing','jurisdiction','United Kingdom',
    'event_date','2026-10-23','deadline','','sectors','[]'::jsonb,'watchpoints','[]'::jsonb,
    'facts',jsonb_build_array(jsonb_build_object('id','F1','statement','Test evidence.', 'evidence_url',url,'page',null,'location','Opening paragraph')));
  begin
    perform public.save_review_draft(null,url,r,0,false,repeat('e',64));
    raise exception 'Stale new draft accepted';
  exception when others then if sqlerrm not like 'Source has changed%' then raise; end if; end;
  d := public.save_review_draft(null,url,r,0,false,source_hash);
  if exists(select 1 from public.political_events where slug='review-'||(d->>'id')) then raise exception 'Draft leaked'; end if;
  begin
    perform public.save_review_draft((d->>'id')::uuid,url,r,0);
    raise exception 'Conflict accepted';
  exception when others then if sqlerrm not like 'Draft changed%' then raise; end if; end;
  begin
    perform public.set_review_publication((d->>'id')::uuid,1,true,false);
    raise exception 'Unchecked publication accepted';
  exception when others then if sqlerrm not like 'Confirm that%' then raise; end if; end;
  d := public.set_review_publication((d->>'id')::uuid,1,true,true);
  if not exists(select 1 from public.political_events where slug='review-'||(d->>'id')) then raise exception 'Publication missing'; end if;
  first_title := r->>'title';
  r := jsonb_set(r,'{title}','"Unpublished replacement"');
  d := public.save_review_draft((d->>'id')::uuid,url,r,1);
  if (select title from public.political_events where slug='review-'||(d->>'id')) <> first_title then raise exception 'Private edit leaked'; end if;
  r := jsonb_set(r,'{facts,0,evidence_url}','"https://evil.example/fake.pdf"');
  d := public.save_review_draft((d->>'id')::uuid,url,r,2);
  begin
    perform public.set_review_publication((d->>'id')::uuid,3,true,true);
    raise exception 'Invalid citation accepted';
  exception when others then if sqlerrm not like 'Evidence must%' then raise; end if; end;
  d := public.set_review_publication((d->>'id')::uuid,3,false,false);
  if exists(select 1 from public.political_events where slug='review-'||(d->>'id')) then raise exception 'Unpublish failed'; end if;
  if (select count(*) from public.review_history where draft_id=(d->>'id')::uuid)<>5 then raise exception 'Audit history incomplete'; end if;
end $$;
reset role;
-- A refreshed document must block approval of an earlier snapshot.
update public.source_documents set content_hash=repeat('e',64) where source_url=(select source_url from public.review_drafts limit 1);
set local role authenticated;
do $$ declare d public.review_drafts%rowtype; begin
  select * into d from public.review_drafts limit 1;
  begin
    perform public.set_review_publication(d.id,d.revision,true,true);
    raise exception 'Stale evidence published';
  exception when others then if sqlerrm not like 'Source has changed%' then raise; end if; end;
end $$;
reset role;
set local request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated","user_metadata":{"role":"admin","email":"signalaiproject1@gmail.com"}}';
set local role authenticated;
do $$ begin
  if public.can_review() or exists(select 1 from public.review_drafts) or exists(select 1 from public.review_history) or exists(select 1 from public.source_versions) then raise exception 'Outsider read private data'; end if;
  begin
    perform public.save_review_draft(null,'https://example.invalid','{}',0);
    raise exception 'Outsider wrote draft';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  if has_table_privilege('anon','public.review_drafts','select')
    or has_table_privilege('authenticated','public.review_drafts','update')
    or has_function_privilege('anon','public.save_review_draft(uuid,text,jsonb,integer,boolean,text)','execute')
    or has_function_privilege('anon','public.set_review_publication(uuid,integer,boolean,boolean)','execute')
    then raise exception 'Public permission boundary failed'; end if;
end $$;
rollback;
