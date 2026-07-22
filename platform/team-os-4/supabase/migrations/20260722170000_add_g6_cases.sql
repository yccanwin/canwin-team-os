-- G6 case publication foundation.

create table public.case_candidates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  fulfillment_unit_id uuid not null,
  customer_id uuid not null,
  display_authorization_valid boolean not null default false,
  authorization_source text,
  authorization_scope text,
  authorization_valid_from timestamptz,
  authorization_valid_until timestamptz,
  authorization_recorded_at timestamptz,
  authorization_withdrawn_at timestamptz,
  authorization_withdrawn_by uuid,
  authorization_withdrawal_reason text,
  created_at timestamptz not null default now(),
  constraint case_candidates_company_identity unique (id, company_id),
  constraint case_candidates_fulfillment unique (company_id, fulfillment_unit_id),
  constraint case_candidates_fulfillment_company_fk foreign key (fulfillment_unit_id, company_id)
    references public.fulfillment_units(id, company_id) on delete restrict,
  constraint case_candidates_customer_company_fk foreign key (customer_id, company_id)
    references public.customers(id, company_id) on delete restrict,
  constraint case_candidates_withdrawer_company_fk foreign key (authorization_withdrawn_by, company_id)
    references public.profiles(id, company_id) on delete restrict,
  constraint case_candidates_authorization_consistent check (
    (display_authorization_valid and authorization_source is not null and btrim(authorization_source) <> ''
      and authorization_scope is not null and btrim(authorization_scope) <> ''
      and authorization_valid_from is not null and authorization_recorded_at is not null
      and authorization_withdrawn_at is null and authorization_withdrawn_by is null and authorization_withdrawal_reason is null)
    or (not display_authorization_valid)
  ),
  constraint case_candidates_authorization_window check (
    authorization_valid_until is null or authorization_valid_until > authorization_valid_from
  ),
  constraint case_candidates_withdrawal_consistent check (
    (authorization_withdrawn_at is null and authorization_withdrawn_by is null and authorization_withdrawal_reason is null)
    or (authorization_withdrawn_at is not null and authorization_withdrawn_by is not null
      and authorization_withdrawal_reason is not null and btrim(authorization_withdrawal_reason) <> '')
  )
);

create table public.cases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  candidate_id uuid not null,
  title text not null,
  summary text not null,
  status text not null default 'draft',
  authorization_valid boolean not null default false,
  admin_reviewed_by uuid,
  admin_reviewed_at timestamptz,
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint cases_company_identity unique (id, company_id),
  constraint cases_candidate_identity unique (company_id, candidate_id),
  constraint cases_candidate_company_fk foreign key (candidate_id, company_id)
    references public.case_candidates(id, company_id) on delete restrict,
  constraint cases_reviewer_company_fk foreign key (admin_reviewed_by, company_id)
    references public.profiles(id, company_id) on delete restrict,
  constraint cases_title_not_blank check (btrim(title) <> ''),
  constraint cases_summary_not_blank check (btrim(summary) <> ''),
  constraint cases_status check (status in ('draft', 'published', 'unpublished')),
  constraint cases_review_consistent check (
    (admin_reviewed_by is null and admin_reviewed_at is null)
    or (admin_reviewed_by is not null and admin_reviewed_at is not null)
  ),
  constraint cases_publish_contract check (
    (status <> 'published' and published_at is null)
    or (
      status = 'published'
      and authorization_valid
      and admin_reviewed_by is not null
      and admin_reviewed_at is not null
      and published_at is not null
    )
  )
);

create table public.case_media (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  case_id uuid not null,
  media_type text not null,
  object_path text not null,
  mime_type text not null,
  size_bytes integer not null,
  created_at timestamptz not null default now(),
  constraint case_media_case_type unique (case_id, media_type),
  constraint case_media_case_company_fk foreign key (case_id, company_id)
    references public.cases(id, company_id) on delete restrict,
  constraint case_media_type check (media_type in ('logo', 'display_code')),
  constraint case_media_path_not_blank check (btrim(object_path) <> ''),
  constraint case_media_mime check (mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  constraint case_media_size check (
    size_bytes > 0
    and (
      (media_type = 'logo' and size_bytes <= 204800)
      or (media_type = 'display_code' and size_bytes <= 307200)
    )
  )
);

create or replace function private.unpublish_case_on_authorization_withdrawal()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if old.display_authorization_valid and not new.display_authorization_valid then
    update public.cases
    set status = 'unpublished', authorization_valid = false,
        published_at = null, updated_at = pg_catalog.now()
    where candidate_id = new.id and company_id = new.company_id;
  end if;
  return new;
end;
$function$;
revoke all on function private.unpublish_case_on_authorization_withdrawal() from public;
create trigger case_authorization_withdrawal_unpublishes
after update of display_authorization_valid on public.case_candidates
for each row execute function private.unpublish_case_on_authorization_withdrawal();

create or replace function private.enforce_case_publication_authorization()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if new.status = 'published' and not exists (
    select 1 from public.case_candidates cc
    where cc.id = new.candidate_id and cc.company_id = new.company_id
      and cc.display_authorization_valid and cc.authorization_withdrawn_at is null
      and (cc.authorization_valid_until is null or cc.authorization_valid_until > pg_catalog.now())
  ) then
    raise exception 'published case requires current customer display authorization'
      using errcode = '23514';
  end if;
  return new;
end;
$function$;
revoke all on function private.enforce_case_publication_authorization() from public;
create trigger cases_require_current_authorization
before insert or update on public.cases
for each row execute function private.enforce_case_publication_authorization();

alter table public.case_candidates enable row level security;
alter table public.cases enable row level security;
alter table public.case_media enable row level security;
revoke all on table public.case_candidates, public.cases, public.case_media from anon, authenticated;
grant select on table public.cases, public.case_media to anon;
grant select, insert, update, delete on table public.case_candidates, public.cases, public.case_media to authenticated;
grant all privileges on table public.case_candidates, public.cases, public.case_media to service_role;

create policy cases_public_select_published on public.cases for select to anon, authenticated
using (status = 'published' and authorization_valid);
create policy case_media_public_select_published on public.case_media for select to anon, authenticated
using (exists (select 1 from public.cases c where c.id=case_media.case_id and c.company_id=case_media.company_id and c.status='published' and c.authorization_valid));
create policy case_candidates_admin_manage on public.case_candidates for all to authenticated
using (private.is_company_admin(company_id)) with check (private.is_company_admin(company_id));
create policy cases_admin_manage on public.cases for all to authenticated
using (private.is_company_admin(company_id)) with check (private.is_company_admin(company_id));
create policy case_media_admin_manage on public.case_media for all to authenticated
using (private.is_company_admin(company_id)) with check (private.is_company_admin(company_id));

comment on table public.case_media is
  'Exactly zero or one logo and zero or one display code per case; no third media category is permitted.';
