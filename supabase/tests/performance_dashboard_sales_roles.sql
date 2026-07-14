do $$
declare
  definition text;
begin
  if to_regprocedure('public.get_performance_management_dashboard(date)') is null then
    raise exception 'Performance dashboard RPC signature changed';
  end if;

  definition:=lower(pg_get_functiondef(
    'public.get_performance_management_dashboard(date)'::regprocedure
  ));

  if position('profile_access_roles' in definition)=0
    or position('access_roles' in definition)=0
    or position('ar.code=''sales''' in definition)=0
    or position('p.status=''active''' in definition)=0 then
    raise exception 'Performance dashboard is not restricted to active sales members';
  end if;
  if position('can_supervise_performance' in definition)=0
    or position('array[''owner'',''admin'']' in definition)=0
    or position('finance.read' in definition)=0 then
    raise exception 'Performance dashboard viewer boundaries changed';
  end if;
end $$;
