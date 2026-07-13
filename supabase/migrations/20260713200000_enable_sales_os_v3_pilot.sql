update public.feature_flags
set enabled = true,
    updated_at = now()
where team_id = 'CANWIN_TEAM'
  and key = 'sales_os_v3';
