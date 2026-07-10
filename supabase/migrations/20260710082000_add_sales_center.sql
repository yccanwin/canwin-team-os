create table if not exists public.sales_products (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references public.teams(id) default 'CANWIN_TEAM',
  name text not null,
  points numeric(10,1) not null default 0 check (points >= 0),
  category text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sales_score_records (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references public.teams(id) default 'CANWIN_TEAM',
  salesperson_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.sales_products(id) on delete restrict,
  product_name text not null,
  quantity integer not null default 1 check (quantity > 0),
  points numeric(10,1) not null default 0 check (points >= 0),
  sold_at date not null default current_date,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.sales_assessments (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references public.teams(id) default 'CANWIN_TEAM',
  period_quarter text not null,
  salesperson_ids uuid[] not null default '{}',
  point_target numeric(10,1) not null default 3600 check (point_target >= 0),
  new_gmv_target numeric(12,2) not null default 0 check (new_gmv_target >= 0),
  new_gmv_actual numeric(12,2) not null default 0 check (new_gmv_actual >= 0),
  renewal_gmv_target numeric(12,2) not null default 0 check (renewal_gmv_target >= 0),
  renewal_gmv_actual numeric(12,2) not null default 0 check (renewal_gmv_actual >= 0),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (team_id, period_quarter)
);

create index if not exists sales_score_records_team_sold_at_idx
on public.sales_score_records (team_id, sold_at desc);

create index if not exists sales_score_records_salesperson_idx
on public.sales_score_records (salesperson_id);

alter table public.sales_products enable row level security;
alter table public.sales_score_records enable row level security;
alter table public.sales_assessments enable row level security;

drop policy if exists "team members read sales products" on public.sales_products;
drop policy if exists "captains manage sales products" on public.sales_products;
drop policy if exists "team members read sales records" on public.sales_score_records;
drop policy if exists "captains manage sales records" on public.sales_score_records;
drop policy if exists "team members read sales assessments" on public.sales_assessments;
drop policy if exists "captains manage sales assessments" on public.sales_assessments;

create policy "team members read sales products"
on public.sales_products for select
to authenticated
using (public.is_team_member(team_id));

create policy "captains manage sales products"
on public.sales_products for all
to authenticated
using (public.has_role(team_id, array['admin','captain']))
with check (public.has_role(team_id, array['admin','captain']));

create policy "team members read sales records"
on public.sales_score_records for select
to authenticated
using (public.is_team_member(team_id));

create policy "captains manage sales records"
on public.sales_score_records for all
to authenticated
using (public.has_role(team_id, array['admin','captain']))
with check (public.has_role(team_id, array['admin','captain']));

create policy "team members read sales assessments"
on public.sales_assessments for select
to authenticated
using (public.is_team_member(team_id));

create policy "captains manage sales assessments"
on public.sales_assessments for all
to authenticated
using (public.has_role(team_id, array['admin','captain']))
with check (public.has_role(team_id, array['admin','captain']));

insert into public.sales_products (team_id, name, points, category)
select team_id, name, points, category
from (
  values
    ('CANWIN_TEAM', '客如云POS', 80.0, '客如云'),
    ('CANWIN_TEAM', '客如云收银', 60.0, '客如云'),
    ('CANWIN_TEAM', '客如云KDS', 50.0, '客如云'),
    ('CANWIN_TEAM', '客如云小程序', 40.0, '客如云'),
    ('CANWIN_TEAM', '客如云会员', 40.0, '客如云'),
    ('CANWIN_TEAM', '客如云营销', 40.0, '客如云'),
    ('CANWIN_TEAM', '客如云供应链', 60.0, '客如云'),
    ('CANWIN_TEAM', '客如云报表', 30.0, '客如云'),
    ('CANWIN_TEAM', '客如云自助', 40.0, '客如云'),
    ('CANWIN_TEAM', '客如云排队', 30.0, '客如云'),
    ('CANWIN_TEAM', '客如云预订', 40.0, '客如云')
) as seed(team_id, name, points, category)
where not exists (
  select 1 from public.sales_products where team_id = 'CANWIN_TEAM'
);
