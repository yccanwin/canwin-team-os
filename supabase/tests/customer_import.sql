-- Structural smoke test. Rollback semantics are exercised by customer_import_behavior.sql.
do $$begin
 if to_regclass('public.import_batches')is null or to_regclass('public.import_rows')is null or to_regclass('public.import_created_entities')is null then raise exception'Import tables missing';end if;
 if to_regclass('public.import_update_snapshots')is null or to_regclass('public.import_rollback_conflicts')is null then raise exception'Rollback support tables missing';end if;
 if not exists(select 1 from information_schema.columns where table_schema='public'and table_name='import_created_entities'and column_name='after_data')then raise exception'170000 after_data upgrade missing';end if;
 if to_regprocedure('public.capture_import_created_entity_image()')is null or to_regprocedure('public.rollback_customer_import(uuid)')is null then raise exception'Rollback functions missing';end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.import_created_entities'::regclass and tgname='import_created_entity_image')then raise exception'170000 image trigger missing';end if;
 if exists(select 1 from pg_policies where schemaname='public'and tablename in('import_rows','import_created_entities')and cmd in('INSERT','UPDATE','DELETE','ALL'))then raise exception'Import history client-mutable';end if;
 if has_function_privilege('anon','public.rollback_customer_import(uuid)','EXECUTE')then raise exception'Anonymous rollback exposed';end if;
end$$;
select'customer_import_structure_ok'result;
