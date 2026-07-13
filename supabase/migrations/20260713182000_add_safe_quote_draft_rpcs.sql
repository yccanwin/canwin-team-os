-- Server-owned quote drafting. Clients may choose catalog/package entries and customer prices,
-- but ownership, snapshots and internal prices are derived and validated here.
create or replace function public.create_deal_quote_draft(p_opportunity_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.profiles;o public.crm_opportunities;q public.deal_quotes;v integer;
begin
 select*into r from public.profiles where id=auth.uid()and status='active';select*into o from public.crm_opportunities where id=p_opportunity_id;
 if r.id is null or o.id is null or o.team_id<>r.team_id or not public.is_feature_enabled(r.team_id,'sales_os_v3')or not public.has_permission(r.team_id,'customers.manage')or not(o.owner_id=r.id or public.can_act_for(r.team_id,o.owner_id))then raise exception'QUOTE_CREATE_FORBIDDEN'using errcode='42501';end if;
 select*into q from public.deal_quotes where opportunity_id=o.id and owner_id=o.owner_id and status='draft'order by version_no desc limit 1;if q.id is not null then return q.id;end if;
 select coalesce(max(version_no),0)+1 into v from public.deal_quotes where team_id=o.team_id and opportunity_id=o.id;
 insert into public.deal_quotes(team_id,opportunity_id,owner_id,version_no,created_by)values(o.team_id,o.id,o.owner_id,v,r.id)returning*into q;return q.id;
end$$;

create or replace function public.replace_deal_quote_lines(p_quote_id uuid,p_lines jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.profiles;q public.deal_quotes;x jsonb;i public.deal_catalog_items;p public.deal_packages;pi record;qty numeric;price numeric;kind text;source uuid;weight numeric;total_weight numeric;
begin
 select*into r from public.profiles where id=auth.uid()and status='active';select*into q from public.deal_quotes where id=p_quote_id for update;
 if r.id is null or q.id is null or q.team_id<>r.team_id or q.status<>'draft'or not public.is_feature_enabled(r.team_id,'sales_os_v3')or not public.has_permission(r.team_id,'customers.manage')or not(q.owner_id=r.id or public.can_act_for(r.team_id,q.owner_id))then raise exception'QUOTE_EDIT_FORBIDDEN'using errcode='42501';end if;
 if jsonb_typeof(p_lines)<>'array'or jsonb_array_length(p_lines)=0 then raise exception'QUOTE_LINES_REQUIRED'using errcode='22023';end if;
 delete from public.deal_quote_lines where quote_id=q.id and team_id=q.team_id;
 for x in select value from jsonb_array_elements(p_lines)loop
  kind:=x->>'kind';source:=nullif(x->>'source_id','')::uuid;qty:=(x->>'quantity')::numeric;price:=(x->>'customer_price')::numeric;
  if qty<=0 or price<0 or kind not in('package','hardware','addon')then raise exception'INVALID_QUOTE_LINE'using errcode='22023';end if;
  if kind='package'then
   select*into p from public.deal_packages where id=source and team_id=q.team_id;if p.id is null then raise exception'PACKAGE_NOT_FOUND'using errcode='P0002';end if;
   select sum(ci.customer_list_price*pi.quantity)into total_weight from public.deal_package_items pi join public.deal_catalog_items ci on ci.id=pi.catalog_item_id and ci.team_id=pi.team_id where pi.package_id=p.id and pi.team_id=q.team_id;if coalesce(total_weight,0)<=0 then raise exception'PACKAGE_EMPTY'using errcode='23514';end if;
   for pi in select ci.*,dpi.quantity package_qty from public.deal_package_items dpi join public.deal_catalog_items ci on ci.id=dpi.catalog_item_id and ci.team_id=dpi.team_id where dpi.package_id=p.id and dpi.team_id=q.team_id loop
    weight:=pi.customer_list_price*pi.package_qty/total_weight;
    insert into public.deal_quote_lines(team_id,quote_id,source_item_id,item_name_snapshot,sku_snapshot,item_type_snapshot,quantity,customer_unit_price,internal_unit_price,points_snapshot)
    values(q.team_id,q.id,pi.id,p.name||' / '||pi.name,pi.sku,pi.item_type,qty*pi.package_qty,round(price*weight/pi.package_qty,2),round(pi.procurement_cost*1.10,2),pi.points);
   end loop;
  else
   select*into i from public.deal_catalog_items where id=source and team_id=q.team_id and(case when kind='hardware'then item_type='hardware'else item_type in('software','service')end);if i.id is null then raise exception'CATALOG_ITEM_NOT_FOUND'using errcode='P0002';end if;
   insert into public.deal_quote_lines(team_id,quote_id,source_item_id,item_name_snapshot,sku_snapshot,item_type_snapshot,quantity,customer_unit_price,internal_unit_price,points_snapshot)
   values(q.team_id,q.id,i.id,i.name,i.sku,i.item_type,qty,price,round(i.procurement_cost*1.10,2),i.points);
  end if;
 end loop;update public.deal_quotes set updated_at=now()where id=q.id;return q.id;
end$$;
revoke all on function public.create_deal_quote_draft(uuid),public.replace_deal_quote_lines(uuid,jsonb)from public;
grant execute on function public.create_deal_quote_draft(uuid),public.replace_deal_quote_lines(uuid,jsonb)to authenticated;
notify pgrst,'reload schema';
