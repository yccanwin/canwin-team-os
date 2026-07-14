do $test$
declare
  definition text;
  tables text[]:=array[
    'crm_brands','crm_stores','crm_contacts','crm_contact_private',
    'crm_leads','crm_opportunities','crm_followups','crm_owner_history'
  ];
  errors text[]:=array[
    'crm_cross_team_brand','crm_cross_team_store','crm_cross_team_contact',
    'crm_cross_team_private_contact','crm_cross_team_lead',
    'crm_cross_team_opportunity','crm_cross_team_followup','crm_cross_team_history'
  ];
  branch_start integer;
  branch_end integer;
  branch_definition text;
  field_match text[];
  i integer;
  trigger_count integer;
begin
  select lower(p.prosrc) into definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='crm_validate_team_references'
    and p.pronargs=0;

  if definition is null then
    raise exception 'crm_validate_team_references() is missing';
  end if;

  for i in 1..array_length(tables,1) loop
    branch_start:=position(
      case when i=1 then 'if ' else 'elsif ' end
      ||'tg_table_name='''||tables[i]||''' then'
      in definition
    );
    if branch_start=0 then
      raise exception 'Missing isolated outer branch for %',tables[i];
    end if;

    if position(errors[i] in definition)=0 then
      raise exception 'Missing preserved cross-team error for %',tables[i];
    end if;

    if i<array_length(tables,1) then
      branch_end:=position(
        'elsif tg_table_name='''||tables[i+1]||''' then'
        in definition
      );
    else
      branch_end:=position(E'\n  end if;\n\n  return new;' in definition);
    end if;
    if branch_end<=branch_start then
      raise exception 'Cannot isolate branch body for %',tables[i];
    end if;

    branch_definition:=substring(
      definition from branch_start for branch_end-branch_start
    );

    -- Every NEW.field used by a branch must exist on that branch's table.
    for field_match in
      select regexp_matches(branch_definition,'new\.([a-z_][a-z0-9_]*)','g')
    loop
      if not exists (
        select 1
        from information_schema.columns c
        where c.table_schema='public'
          and c.table_name=tables[i]
          and c.column_name=field_match[1]
      ) then
        raise exception 'Branch % references foreign NEW field %',tables[i],field_match[1];
      end if;
    end loop;

    if tables[i]='crm_leads' and position('contact_id' in branch_definition)>0 then
      raise exception 'crm_leads branch still references contact_id';
    end if;
  end loop;

  select count(*) into trigger_count
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_proc p on p.oid=t.tgfoid
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  join pg_catalog.pg_class c on c.oid=t.tgrelid
  where not t.tgisinternal
    and n.nspname='public'
    and p.proname='crm_validate_team_references'
    and c.relname=any(tables);

  if trigger_count<>8 then
    raise exception 'Expected 8 CRM team guard triggers, found %',trigger_count;
  end if;
end
$test$;
