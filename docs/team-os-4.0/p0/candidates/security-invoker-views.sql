-- CANDIDATE ONLY - DO NOT RUN ON PRODUCTION.
-- P0 local review artifact. It has not been executed against any database.
-- Scope is limited to the three current security_definer_view ERRORs and the
-- four existing read/manage policies that must recognize the frozen 4.0 roles.
-- Authorization: authenticated may SELECT the views; PUBLIC and anon are denied.

alter policy "finance roles read finance records"
on public.finance_records
using (public.has_access_role(team_id, array['finance', 'admin']));

alter policy "finance roles manage finance records"
on public.finance_records
using (public.has_access_role(team_id, array['finance', 'admin']))
with check (public.has_access_role(team_id, array['finance', 'admin']));

alter policy "inventory roles read inventory items"
on public.inventory_items
using (public.is_team_member(team_id));

alter policy "asset roles read assets"
on public.assets
using (public.is_team_member(team_id));

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
where public.has_access_role(fr.team_id, array['finance', 'admin'])
group by fr.team_id, date_trunc('month', fr.date)::date, fr.record_type, fr.category;

revoke all privileges on public.finance_public_summary from public, anon, authenticated;
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

revoke all privileges on public.inventory_public_items from public, anon, authenticated;
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

revoke all privileges on public.assets_public from public, anon, authenticated;
grant select on public.assets_public to authenticated;
