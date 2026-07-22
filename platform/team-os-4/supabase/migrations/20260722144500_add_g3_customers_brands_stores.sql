-- G3 place foundation: customers -> brands -> stores.

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  sales_owner_id uuid not null,
  name text not null,
  region text not null,
  external_source text not null,
  external_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_company_identity unique (id, company_id),
  constraint customers_sales_owner_company_fk
    foreign key (sales_owner_id, company_id)
    references public.profiles(id, company_id) on delete restrict,
  constraint customers_external_identity
    unique (company_id, external_source, external_key),
  constraint customers_name_not_blank check (btrim(name) <> ''),
  constraint customers_region_not_blank check (btrim(region) <> ''),
  constraint customers_external_source_not_blank check (btrim(external_source) <> ''),
  constraint customers_external_key_not_blank check (btrim(external_key) <> '')
);

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  customer_id uuid not null,
  name text not null,
  external_source text not null,
  external_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brands_company_identity unique (id, company_id),
  constraint brands_customer_company_fk
    foreign key (customer_id, company_id)
    references public.customers(id, company_id) on delete restrict,
  constraint brands_external_identity
    unique (company_id, external_source, external_key),
  constraint brands_name_not_blank check (btrim(name) <> ''),
  constraint brands_external_source_not_blank check (btrim(external_source) <> ''),
  constraint brands_external_key_not_blank check (btrim(external_key) <> '')
);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  brand_id uuid not null,
  name text not null,
  address text not null,
  store_type text not null,
  external_source text not null,
  external_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stores_company_identity unique (id, company_id),
  constraint stores_brand_company_fk
    foreign key (brand_id, company_id)
    references public.brands(id, company_id) on delete restrict,
  constraint stores_external_identity
    unique (company_id, external_source, external_key),
  constraint stores_name_not_blank check (btrim(name) <> ''),
  constraint stores_address_not_blank check (btrim(address) <> ''),
  constraint stores_type check (store_type in ('new', 'competitor_existing')),
  constraint stores_external_source_not_blank check (btrim(external_source) <> ''),
  constraint stores_external_key_not_blank check (btrim(external_key) <> '')
);

create index customers_sales_owner_idx on public.customers(company_id, sales_owner_id);
create index brands_customer_idx on public.brands(customer_id, company_id);
create index stores_brand_idx on public.stores(brand_id, company_id);

alter table public.customers enable row level security;
alter table public.brands enable row level security;
alter table public.stores enable row level security;

revoke all on table public.customers from anon, authenticated;
revoke all on table public.brands from anon, authenticated;
revoke all on table public.stores from anon, authenticated;
grant select on table public.customers to authenticated;
grant select on table public.brands to authenticated;
grant select on table public.stores to authenticated;
grant all privileges on table public.customers to service_role;
grant all privileges on table public.brands to service_role;
grant all privileges on table public.stores to service_role;

create policy customers_select_sales_owner_or_admin
on public.customers for select to authenticated
using (
  (sales_owner_id = (select auth.uid()) and private.is_active_company_member(company_id))
  or private.is_company_admin(company_id)
);

create policy brands_select_sales_owner_or_admin
on public.brands for select to authenticated
using (
  exists (
    select 1 from public.customers as c
    where c.id = brands.customer_id
      and c.company_id = brands.company_id
      and c.sales_owner_id = (select auth.uid())
      and private.is_active_company_member(brands.company_id)
  )
  or private.is_company_admin(brands.company_id)
);

create policy stores_select_sales_owner_or_admin
on public.stores for select to authenticated
using (
  exists (
    select 1
    from public.brands as b
    join public.customers as c
      on c.id = b.customer_id and c.company_id = b.company_id
    where b.id = stores.brand_id
      and b.company_id = stores.company_id
      and c.sales_owner_id = (select auth.uid())
      and private.is_active_company_member(stores.company_id)
  )
  or private.is_company_admin(stores.company_id)
);
