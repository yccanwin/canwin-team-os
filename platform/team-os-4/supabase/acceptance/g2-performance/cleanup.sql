-- psql variables required:
--   run_id
--   target_project_ref
-- This removes only the run-marked profiles/work_items. The returned
-- auth_user_ids must then be deleted one by one with server-side
-- Supabase Auth Admin deleteUser. Never delete Auth users from SQL.

\set ON_ERROR_STOP on

begin;

select public.cleanup_g2_performance_fixture_v1(
  :'run_id',
  :'target_project_ref'
) as cleanup_result;

select pg_catalog.count(*) as remaining_performance_work_items
from public.work_items as item
where item.source_business = 'g2_performance'
  and item.generation_rule = 'g2-performance:' || :'run_id';

select pg_catalog.count(*) as remaining_performance_profiles
from public.profiles as profile
where profile.display_name like 'G2 performance ' || :'run_id' || ' #%';

commit;
