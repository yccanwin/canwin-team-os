-- C8: finite WeCom retries, payload allowlist, health/status and manual single retry.

alter table public.notification_jobs add column manual_retry_count integer not null default 0 check(manual_retry_count between 0 and 1);
alter table public.notification_jobs add column last_manual_retry_at timestamptz;
alter table public.notification_jobs add column retry_cycle integer not null default 0 check(retry_cycle between 0 and 1);
alter table public.notification_attempts add column retry_cycle integer not null default 0 check(retry_cycle between 0 and 1);
alter table public.notification_attempts drop constraint if exists notification_attempts_job_id_attempt_no_key;
alter table public.notification_attempts add constraint notification_attempts_job_cycle_attempt_key unique(job_id,retry_cycle,attempt_no);

create table public.notification_channel_status(
 team_id text primary key references public.teams(id),channel text not null default'wecom'check(channel='wecom'),configured boolean not null default false,
 last_worker_at timestamptz,last_success_at timestamptz,last_error_code text,updated_at timestamptz not null default now()
);

create or replace function public.validate_notification_payload()returns trigger
language plpgsql set search_path='' as $function$
declare v_allowed text[];v_key text;
begin
 v_allowed:=case when new.job_type='daily_summary'then array['kind','date','title','due_count','recycle_risk_count']else array['kind','title','appointment_at']end;
 for v_key in select jsonb_object_keys(new.payload)loop if not(v_key=any(v_allowed))then raise exception'NOTIFICATION_PAYLOAD_KEY_FORBIDDEN:%',v_key using errcode='22023';end if;end loop;
 if new.payload->>'kind'is distinct from new.job_type then raise exception'NOTIFICATION_KIND_MISMATCH'using errcode='22023';end if;
 return new;
end
$function$;
drop trigger if exists validate_notification_payload on public.notification_jobs;
create trigger validate_notification_payload before insert or update of payload,job_type on public.notification_jobs for each row execute function public.validate_notification_payload();

create or replace function public.complete_wecom_notification_job(p_job_id uuid,p_succeeded boolean,p_error_code text default null,p_error_message text default null,p_now timestamptz default now())
returns public.notification_jobs language plpgsql security definer set search_path='' as $function$
declare v_job public.notification_jobs;v_attempt integer;
begin
 if current_setting('request.jwt.claim.role',true)<>'service_role'then raise exception'SERVICE_ROLE_REQUIRED'using errcode='42501';end if;
 select j.*into v_job from public.notification_jobs j where j.id=p_job_id for update;if v_job.id is null then raise exception'JOB_NOT_FOUND'using errcode='P0002';end if;
 if v_job.status in('sent','failed')then return v_job;end if;v_attempt:=v_job.attempt_count+1;
 insert into public.notification_attempts(team_id,job_id,retry_cycle,attempt_no,succeeded,error_code,error_message,attempted_at)values(v_job.team_id,v_job.id,v_job.retry_cycle,v_attempt,p_succeeded,left(p_error_code,80),left(p_error_message,1000),p_now);
 if p_succeeded then
  update public.notification_jobs set status='sent',attempt_count=v_attempt,sent_at=p_now,last_error=null where id=v_job.id returning*into v_job;
  insert into public.notification_channel_status(team_id,configured,last_worker_at,last_success_at,last_error_code,updated_at)values(v_job.team_id,true,p_now,p_now,null,p_now)
  on conflict(team_id)do update set configured=true,last_worker_at=excluded.last_worker_at,last_success_at=excluded.last_success_at,last_error_code=null,updated_at=excluded.updated_at;
  insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,after_data)values(v_job.team_id,null,'notification.sent','notification_job',v_job.id,jsonb_build_object('attempt',v_attempt,'job_type',v_job.job_type));
 elsif v_attempt>=5 then
  update public.notification_jobs set status='failed',attempt_count=v_attempt,last_error=left(p_error_message,1000)where id=v_job.id returning*into v_job;
  insert into public.notification_supervisor_exceptions(team_id,job_id,recipient_id,summary)values(v_job.team_id,v_job.id,v_job.recipient_id,'企业微信通知连续失败5次')on conflict(team_id,job_id)do nothing;
  insert into public.notification_channel_status(team_id,configured,last_worker_at,last_error_code,updated_at)values(v_job.team_id,true,p_now,left(p_error_code,80),p_now)
  on conflict(team_id)do update set last_worker_at=excluded.last_worker_at,last_error_code=excluded.last_error_code,updated_at=excluded.updated_at;
  insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,after_data)values(v_job.team_id,null,'notification.failed_final','notification_job',v_job.id,jsonb_build_object('attempts',v_attempt,'error_code',left(p_error_code,80)));
 else
  update public.notification_jobs set status='retry',attempt_count=v_attempt,next_attempt_at=p_now+(power(2,v_attempt-1)*interval'5 minutes'),last_error=left(p_error_message,1000)where id=v_job.id returning*into v_job;
 end if;return v_job;
end
$function$;

create or replace function public.report_wecom_channel_status(p_team_id text,p_configured boolean,p_error_code text default null,p_now timestamptz default now())
returns void language plpgsql security definer set search_path='' as $function$
begin
 if current_setting('request.jwt.claim.role',true)<>'service_role'then raise exception'SERVICE_ROLE_REQUIRED'using errcode='42501';end if;
 insert into public.notification_channel_status(team_id,configured,last_worker_at,last_error_code,updated_at)values(p_team_id,p_configured,p_now,left(p_error_code,80),p_now)
 on conflict(team_id)do update set configured=excluded.configured,last_worker_at=excluded.last_worker_at,last_error_code=excluded.last_error_code,updated_at=excluded.updated_at;
end
$function$;

create or replace function public.get_wecom_notification_status()
returns table(job_id uuid,recipient_name text,job_type text,scheduled_for timestamptz,status text,attempt_count integer,manual_retry_used boolean,last_error text,channel_configured boolean,last_worker_at timestamptz)
language plpgsql security definer stable set search_path='' as $function$
declare v_profile public.profiles;v_supervisor boolean;
begin
 select p.*into v_profile from public.profiles p where p.id=auth.uid()and p.status='active';if v_profile.id is null or not public.is_feature_enabled(v_profile.team_id,'sales_os_v3')then raise exception'NOTIFICATION_FORBIDDEN'using errcode='42501';end if;
 v_supervisor:=public.has_permission(v_profile.team_id,'customers.supervise')or public.has_access_role(v_profile.team_id,array['owner','admin']);
 return query select j.id,p.name,j.job_type,j.scheduled_for,j.status,j.attempt_count,j.manual_retry_count>0,j.last_error,coalesce(c.configured,false),c.last_worker_at
 from public.notification_jobs j join public.profiles p on p.id=j.recipient_id and p.team_id=j.team_id left join public.notification_channel_status c on c.team_id=j.team_id
 where j.team_id=v_profile.team_id and(v_supervisor or j.recipient_id=v_profile.id)order by j.created_at desc limit 200;
end
$function$;

create or replace function public.retry_wecom_notification_once(p_job_id uuid,p_idempotency_key uuid)
returns public.notification_jobs language plpgsql security definer set search_path='' as $function$
declare v_profile public.profiles;v_job public.notification_jobs;v_existing_job uuid;
begin
 if p_idempotency_key is null then raise exception'IDEMPOTENCY_KEY_REQUIRED'using errcode='22023';end if;
 select p.*into v_profile from public.profiles p where p.id=auth.uid()and p.status='active';select j.*into v_job from public.notification_jobs j where j.id=p_job_id for update;
 if v_job.id is null or v_profile.id is null or v_job.team_id<>v_profile.team_id or not public.is_feature_enabled(v_job.team_id,'sales_os_v3')or not(public.has_permission(v_job.team_id,'customers.supervise')or public.has_access_role(v_job.team_id,array['owner','admin']))then raise exception'NOTIFICATION_RETRY_FORBIDDEN'using errcode='42501';end if;
 select a.target_id into v_existing_job from public.audit_logs a where a.team_id=v_job.team_id and a.action='notification.manual_retry'and a.after_data->>'idempotency_key'=p_idempotency_key::text limit 1;
 if v_existing_job is not null then if v_existing_job<>v_job.id then raise exception'IDEMPOTENCY_KEY_CONFLICT'using errcode='23505';end if;return v_job;end if;
 if v_job.status<>'failed'or v_job.manual_retry_count>=1 then raise exception'MANUAL_RETRY_NOT_AVAILABLE'using errcode='55000';end if;
 update public.notification_jobs set status='retry',attempt_count=0,retry_cycle=1,manual_retry_count=1,last_manual_retry_at=now(),next_attempt_at=now(),last_error=null where id=v_job.id returning*into v_job;
 update public.notification_supervisor_exceptions set status='resolved',resolved_at=now()where team_id=v_job.team_id and job_id=v_job.id and status='open';
 insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,after_data)values(v_job.team_id,v_profile.id,'notification.manual_retry','notification_job',v_job.id,jsonb_build_object('idempotency_key',p_idempotency_key,'manual_retry_count',1));return v_job;
end
$function$;

alter table public.notification_channel_status enable row level security;
create policy "notification channel feature gate"on public.notification_channel_status as restrictive for all to authenticated using(public.is_feature_enabled(team_id,'sales_os_v3'))with check(public.is_feature_enabled(team_id,'sales_os_v3'));
create policy "notification channel supervisors read"on public.notification_channel_status for select to authenticated using(public.has_permission(team_id,'customers.supervise')or public.has_access_role(team_id,array['owner','admin']));

revoke all on function public.report_wecom_channel_status(text,boolean,text,timestamptz)from public,anon,authenticated;
grant execute on function public.report_wecom_channel_status(text,boolean,text,timestamptz)to service_role;
revoke all on function public.get_wecom_notification_status(),public.retry_wecom_notification_once(uuid,uuid)from public,anon;
grant execute on function public.get_wecom_notification_status(),public.retry_wecom_notification_once(uuid,uuid)to authenticated;
notify pgrst,'reload schema';
