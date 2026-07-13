-- Server-only WeCom notification queue. No webhook URL is stored in SQL.
create table public.notification_jobs(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),recipient_id uuid not null references public.profiles(id),
 job_type text not null check(job_type in('daily_summary','appointment_day_before','appointment_2h')),
 scheduled_for timestamptz not null,payload jsonb not null check(jsonb_typeof(payload)='object'and not(payload?|array['phone','mobile','amount','price','profit','margin','cost'])),
 status text not null default'pending'check(status in('pending','processing','retry','sent','failed')),attempt_count integer not null default 0 check(attempt_count between 0 and 5),
 next_attempt_at timestamptz not null,idempotency_key text not null,last_error text,created_at timestamptz not null default now(),sent_at timestamptz,
 unique(team_id,id),unique(team_id,idempotency_key)
);
create table public.notification_attempts(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),job_id uuid not null,attempt_no integer not null check(attempt_no between 1 and 5),
 succeeded boolean not null,error_code text,error_message text,attempted_at timestamptz not null default now(),unique(team_id,id),unique(job_id,attempt_no),
 foreign key(team_id,job_id)references public.notification_jobs(team_id,id)
);
create table public.notification_supervisor_exceptions(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),job_id uuid not null,recipient_id uuid not null references public.profiles(id),
 summary text not null,status text not null default'open'check(status in('open','resolved')),created_at timestamptz not null default now(),resolved_at timestamptz,
 unique(team_id,id),unique(team_id,job_id),foreign key(team_id,job_id)references public.notification_jobs(team_id,id)
);

create or replace function public.enqueue_wecom_notification_jobs(p_team_id text,p_now timestamptz default now())
returns integer language plpgsql security definer set search_path=''as$$
declare today_cn date:=(p_now at time zone'Asia/Shanghai')::date;inserted integer:=0;n integer;
begin if current_setting('request.jwt.claim.role',true)<>'service_role'then raise exception'SERVICE_ROLE_REQUIRED'using errcode='42501';end if;
 if not public.is_feature_enabled(p_team_id,'sales_os_v3')then raise exception'SALES_OS_V3_DISABLED'using errcode='42501';end if;
 insert into public.notification_jobs(team_id,recipient_id,job_type,scheduled_for,next_attempt_at,idempotency_key,payload)
 select p.team_id,p.id,'daily_summary',((today_cn+time'09:30')at time zone'Asia/Shanghai'),((today_cn+time'09:30')at time zone'Asia/Shanghai'),
  'daily:'||p.id||':'||today_cn,jsonb_build_object('kind','daily_summary','date',today_cn,'title','今日工作摘要',
   'due_count',(select count(*)from public.crm_leads l where l.team_id=p.team_id and l.owner_id=p.id and l.next_action_at is not null and(l.next_action_at at time zone'Asia/Shanghai')::date<=today_cn),
   'recycle_risk_count',(select count(*)from public.crm_leads l where l.team_id=p.team_id and l.owner_id=p.id and l.attention_status='uncontacted_24h'))
 from public.profiles p where p.team_id=p_team_id and p.status='active'
 on conflict(team_id,idempotency_key)do nothing;get diagnostics n=row_count;inserted:=inserted+n;
 insert into public.notification_jobs(team_id,recipient_id,job_type,scheduled_for,next_attempt_at,idempotency_key,payload)
 select l.team_id,l.owner_id,'appointment_day_before',((((l.next_action_at at time zone'Asia/Shanghai')::date-1)+time'10:00')at time zone'Asia/Shanghai'),
  ((((l.next_action_at at time zone'Asia/Shanghai')::date-1)+time'10:00')at time zone'Asia/Shanghai'),'appt-day:'||l.id||':'||l.next_action_at,
  jsonb_build_object('kind','appointment_day_before','title','预约提醒','appointment_at',l.next_action_at)
 from public.crm_leads l where l.team_id=p_team_id and l.owner_id is not null and l.next_action_kind='appointment'and l.next_action_at>p_now
  and ((((l.next_action_at at time zone'Asia/Shanghai')::date-1)+time'10:00')at time zone'Asia/Shanghai') between p_now-interval'1 day'and p_now+interval'2 days'
 on conflict(team_id,idempotency_key)do nothing;get diagnostics n=row_count;inserted:=inserted+n;
 insert into public.notification_jobs(team_id,recipient_id,job_type,scheduled_for,next_attempt_at,idempotency_key,payload)
 select l.team_id,l.owner_id,'appointment_2h',l.next_action_at-interval'2 hours',l.next_action_at-interval'2 hours','appt-2h:'||l.id||':'||l.next_action_at,
  jsonb_build_object('kind','appointment_2h','title','预约提醒','appointment_at',l.next_action_at)
 from public.crm_leads l where l.team_id=p_team_id and l.owner_id is not null and l.next_action_kind='appointment'and l.next_action_at>p_now
  and l.next_action_at-interval'2 hours'between p_now-interval'1 day'and p_now+interval'2 days'
 on conflict(team_id,idempotency_key)do nothing;get diagnostics n=row_count;return inserted+n;end$$;

create or replace function public.claim_wecom_notification_jobs(p_limit integer default 20,p_now timestamptz default now())
returns setof public.notification_jobs language plpgsql security definer set search_path=''as$$
begin if current_setting('request.jwt.claim.role',true)<>'service_role'then raise exception'SERVICE_ROLE_REQUIRED'using errcode='42501';end if;
 return query with picked as(select j.id from public.notification_jobs j where(j.status in('pending','retry')or j.status='processing')and j.next_attempt_at<=p_now and j.scheduled_for<=p_now order by j.next_attempt_at for update skip locked limit greatest(1,least(p_limit,100)))
 update public.notification_jobs j set status='processing',next_attempt_at=p_now+interval'10 minutes'from picked where j.id=picked.id returning j.*;end$$;

create or replace function public.complete_wecom_notification_job(p_job_id uuid,p_succeeded boolean,p_error_code text default null,p_error_message text default null,p_now timestamptz default now())
returns public.notification_jobs language plpgsql security definer set search_path=''as$$
declare j public.notification_jobs;attempt_no integer;
begin if current_setting('request.jwt.claim.role',true)<>'service_role'then raise exception'SERVICE_ROLE_REQUIRED'using errcode='42501';end if;
 select * into j from public.notification_jobs where id=p_job_id for update;if j.id is null then raise exception'JOB_NOT_FOUND'using errcode='P0002';end if;
 if j.status in('sent','failed')then return j;end if;attempt_no:=j.attempt_count+1;
 insert into public.notification_attempts(team_id,job_id,attempt_no,succeeded,error_code,error_message,attempted_at)values(j.team_id,j.id,attempt_no,p_succeeded,left(p_error_code,80),left(p_error_message,1000),p_now);
 if p_succeeded then update public.notification_jobs set status='sent',attempt_count=attempt_no,sent_at=p_now,last_error=null where id=j.id returning*into j;
 elsif attempt_no>=5 then update public.notification_jobs set status='failed',attempt_count=attempt_no,last_error=left(p_error_message,1000)where id=j.id returning*into j;
  insert into public.notification_supervisor_exceptions(team_id,job_id,recipient_id,summary)values(j.team_id,j.id,j.recipient_id,'企业微信通知连续失败5次')on conflict(team_id,job_id)do nothing;
  insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,after_data)values(j.team_id,null,'notification.failed_final','notification_job',j.id,jsonb_build_object('attempts',attempt_no,'error_code',p_error_code));
 else update public.notification_jobs set status='retry',attempt_count=attempt_no,next_attempt_at=p_now+(power(2,attempt_no-1)*interval'5 minutes'),last_error=left(p_error_message,1000)where id=j.id returning*into j;end if;return j;end$$;

do$$declare t text;begin foreach t in array array['notification_jobs','notification_attempts','notification_supervisor_exceptions']loop execute format('alter table public.%I enable row level security',t);execute format('create policy "sales os v3 server gate"on public.%I as restrictive for all to authenticated using(public.is_feature_enabled(team_id,''sales_os_v3''))with check(public.is_feature_enabled(team_id,''sales_os_v3''))',t);end loop;end$$;
create policy"users read own notification jobs"on public.notification_jobs for select to authenticated using(recipient_id=auth.uid()or public.has_permission(team_id,'customers.supervise'));
create policy"users read own notification attempts"on public.notification_attempts for select to authenticated using(exists(select 1 from public.notification_jobs j where j.id=job_id and j.team_id=team_id and(j.recipient_id=auth.uid()or public.has_permission(team_id,'customers.supervise'))));
create policy"supervisors read notification failures"on public.notification_supervisor_exceptions for select to authenticated using(public.has_permission(team_id,'customers.supervise'));
revoke all on function public.enqueue_wecom_notification_jobs(text,timestamptz),public.claim_wecom_notification_jobs(integer,timestamptz),public.complete_wecom_notification_job(uuid,boolean,text,text,timestamptz)from public;
grant execute on function public.enqueue_wecom_notification_jobs(text,timestamptz),public.claim_wecom_notification_jobs(integer,timestamptz),public.complete_wecom_notification_job(uuid,boolean,text,text,timestamptz)to service_role;
notify pgrst,'reload schema';
