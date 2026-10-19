-- Read-only connectivity probe: no application or user data exposed.
create function public.signal_health()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object('project', 'SIGNAL', 'status', 'ok');
$$;
revoke all on function public.signal_health() from public;
grant execute on function public.signal_health() to anon, authenticated;
