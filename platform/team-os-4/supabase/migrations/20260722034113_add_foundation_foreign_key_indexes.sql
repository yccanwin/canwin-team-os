-- Cover the six Team OS 4.0 foundation foreign keys reported by the
-- Supabase performance advisor. This migration is independent from Team OS 3.0.

create index profiles_primary_role_company_fk_idx
  on public.profiles(primary_role_id, company_id);

create index profile_capabilities_profile_company_fk_idx
  on public.profile_capabilities(profile_id, company_id);

create index profile_capabilities_capability_company_fk_idx
  on public.profile_capabilities(capability_id, company_id);

create index profile_capabilities_granted_by_fk_idx
  on public.profile_capabilities(granted_by);

create index system_runtime_state_changed_by_fk_idx
  on public.system_runtime_state(changed_by);

create index initialization_audit_actor_user_id_fk_idx
  on public.initialization_audit(actor_user_id);
