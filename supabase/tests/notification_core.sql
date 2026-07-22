do $$begin
 if to_regclass('public.notification_jobs')is null or to_regclass('public.notification_attempts')is null or to_regclass('public.notification_supervisor_exceptions')is null then raise exception'Notification tables missing';end if;
 if position('09:30' in pg_get_functiondef('public.enqueue_wecom_notification_jobs(text,timestamp with time zone)'::regprocedure))=0 or position('appointment_day_before' in pg_get_functiondef('public.enqueue_wecom_notification_jobs(text,timestamp with time zone)'::regprocedure))=0 or position('2 hours' in pg_get_functiondef('public.enqueue_wecom_notification_jobs(text,timestamp with time zone)'::regprocedure))=0 then raise exception'Notification schedules missing';end if;
 if position('on conflict' in lower(pg_get_functiondef('public.enqueue_wecom_notification_jobs(text,timestamp with time zone)'::regprocedure)))=0 then raise exception'Idempotent enqueue missing';end if;
 if position('v_attempt>=5' in lower(regexp_replace(pg_get_functiondef('public.complete_wecom_notification_job(uuid,boolean,text,text,timestamp with time zone)'::regprocedure),'[[:space:]]+','','g')))=0 or position('power(2' in pg_get_functiondef('public.complete_wecom_notification_job(uuid,boolean,text,text,timestamp with time zone)'::regprocedure))=0 then raise exception'Retry cap/backoff missing';end if;
 if position('notification_supervisor_exceptions' in pg_get_functiondef('public.complete_wecom_notification_job(uuid,boolean,text,text,timestamp with time zone)'::regprocedure))=0 or position('audit_logs' in pg_get_functiondef('public.complete_wecom_notification_job(uuid,boolean,text,text,timestamp with time zone)'::regprocedure))=0 then raise exception'Final failure escalation missing';end if;
 if exists(select 1
  from(values
   ('public.enqueue_wecom_notification_jobs(text,timestamp with time zone)'),
   ('public.claim_wecom_notification_jobs(integer,timestamp with time zone)'),
   ('public.complete_wecom_notification_job(uuid,boolean,text,text,timestamp with time zone)'),
   ('public.report_wecom_channel_status(text,boolean,text,timestamp with time zone)')
  )as f(function_identity)
  cross join(values('anon'),('authenticated'))as r(role_name)
  where has_function_privilege(r.role_name,f.function_identity,'EXECUTE'))then
  raise exception'Notification server-only RPC exposed';end if;
 if exists(select 1
  from(values
   ('public.enqueue_wecom_notification_jobs(text,timestamp with time zone)'),
   ('public.claim_wecom_notification_jobs(integer,timestamp with time zone)'),
   ('public.complete_wecom_notification_job(uuid,boolean,text,text,timestamp with time zone)'),
   ('public.report_wecom_channel_status(text,boolean,text,timestamp with time zone)')
  )as f(function_identity)
  where not has_function_privilege('service_role',f.function_identity,'EXECUTE'))then
  raise exception'Notification service-role RPC grant missing';end if;
 if(select count(*)from pg_policies where schemaname='public'and tablename like'notification_%'and policyname='sales os v3 server gate'and permissive='RESTRICTIVE')<>3 then raise exception'Notification core gates missing';end if;
 if not exists(select 1 from pg_constraint where conrelid='public.notification_jobs'::regclass and contype='c'and pg_get_constraintdef(oid)like'%phone%amount%profit%')then raise exception'Sensitive payload guard missing';end if;
 if exists(select 1 from pg_policies where schemaname='public'and tablename='notification_attempts'
  and permissive='PERMISSIVE'and cmd in('INSERT','UPDATE','DELETE','ALL'))then raise exception'Attempt history permissive write policy found';end if;
 if exists(select 1 from(values('anon'),('authenticated'))as r(role_name)
  cross join(values('INSERT'),('UPDATE'),('DELETE'))as p(privilege_name)
  where has_table_privilege(r.role_name,'public.notification_attempts',p.privilege_name))then
  raise exception'Attempt history direct client write privilege found';end if;
 if to_regclass('public.notification_channel_status')is null then raise exception'Notification channel status missing';end if;
 if not exists(select 1 from information_schema.columns where table_schema='public'and table_name='notification_jobs'and column_name='manual_retry_count')then raise exception'Manual retry guard missing';end if;
 if not exists(select 1 from pg_constraint where conrelid='public.notification_attempts'::regclass and pg_get_constraintdef(oid)like'%job_id, retry_cycle, attempt_no%')then raise exception'Retry cycle attempt uniqueness missing';end if;
 if not has_function_privilege('authenticated','public.get_wecom_notification_status()','EXECUTE')or not has_function_privilege('authenticated','public.retry_wecom_notification_once(uuid,uuid)','EXECUTE')then raise exception'Notification admin RPC missing';end if;
 if position('IDEMPOTENCY_KEY_CONFLICT' in pg_get_functiondef('public.retry_wecom_notification_once(uuid,uuid)'::regprocedure))=0 or position('manual_retry_count' in pg_get_functiondef('public.retry_wecom_notification_once(uuid,uuid)'::regprocedure))=0 then raise exception'Manual retry safety missing';end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.notification_jobs'::regclass and tgname='validate_notification_payload'and not tgisinternal)then raise exception'Payload allowlist trigger missing';end if;
end$$;select'notification_core_ok'result;
