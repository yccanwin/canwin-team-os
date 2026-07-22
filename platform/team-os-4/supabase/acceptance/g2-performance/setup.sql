-- psql variables required:
--   run_id             g2-... unique acceptance run id
--   company_id         Team OS 4.0 company UUID
--   target_project_ref must be jgcrhoabvaowxnqksvkq
--   business_date      current Asia/Shanghai YYYY-MM-DD
--   profile_ids        PostgreSQL UUID array literal containing exactly 30
--                      server-created temporary Auth user ids
-- Run only after Auth Admin createUser has set raw_app_meta_data keys:
--   team_os_4_data_class = g2-performance
--   team_os_4_run_id = <run_id>
--   team_os_4_project_ref = <target_project_ref>

\set ON_ERROR_STOP on

begin;

select public.setup_g2_performance_fixture_v1(
  :'run_id',
  :'company_id'::uuid,
  :'target_project_ref',
  :'business_date'::date,
  :'profile_ids'::uuid[]
) as setup_result;

select
  pg_catalog.count(*) filter (where profile.is_active) as active_performance_profiles
from public.profiles as profile
where profile.id = any(:'profile_ids'::uuid[])
  and profile.company_id = :'company_id'::uuid;

select pg_catalog.count(*) as performance_work_items
from public.work_items as item
where item.company_id = :'company_id'::uuid
  and item.source_business = 'g2_performance'
  and item.generation_rule = 'g2-performance:' || :'run_id';

commit;
