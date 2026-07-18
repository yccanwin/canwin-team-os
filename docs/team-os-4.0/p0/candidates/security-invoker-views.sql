-- CANDIDATE ONLY - DO NOT RUN ON PRODUCTION.
-- P0 local review artifact. It has not been executed against any database.
-- Scope is deliberately limited to the three current security_definer_view ERRORs.
-- Authorization: authenticated may SELECT; PUBLIC and anon are explicitly denied.

create or replace view public.finance_public_summary
with (security_invoker = true) as
select
  fr.team_id,
  date_trunc('month', fr.date)::date as month,
  fr.record_type,
  fr.category,
  sum(fr.amount) as total_amount,
  count(*) as record_count
from public.finance_records as fr
group by fr.team_id, date_trunc('month', fr.date)::date, fr.record_type, fr.category;

revoke all privileges on public.finance_public_summary from public, anon;
grant select on public.finance_public_summary to authenticated;

create or replace view public.inventory_public_items
with (security_invoker = true) as
select
  ii.id,
  ii.team_id,
  ii.name,
  ii.sku,
  ii.quantity,
  ii.unit,
  ii.public_status,
  ii.low_stock_threshold,
  ii.updated_at
from public.inventory_items as ii;

revoke all privileges on public.inventory_public_items from public, anon;
grant select on public.inventory_public_items to authenticated;

create or replace view public.assets_public
with (security_invoker = true) as
select
  a.id,
  a.team_id,
  a.name,
  a.category,
  a.description,
  a.purchase_date,
  a.status,
  a.image_url,
  a.created_by,
  a.created_at,
  a.updated_at
from public.assets as a;

revoke all privileges on public.assets_public from public, anon;
grant select on public.assets_public to authenticated;
