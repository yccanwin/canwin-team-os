-- Supabase may provision direct anon EXECUTE ACLs independently of PUBLIC.
-- Revoke both principals explicitly, then restore the intended callers only.
revoke all on function public.get_operations_lead_intake_context(text,text)
from public,anon;
revoke all on function public.submit_operations_lead(text,text,text,text,text,text,text)
from public,anon;
revoke all on function public.get_my_lead_submissions(integer)
from public,anon;

grant execute on function public.get_operations_lead_intake_context(text,text)
to authenticated,service_role;
grant execute on function public.submit_operations_lead(text,text,text,text,text,text,text)
to authenticated,service_role;
grant execute on function public.get_my_lead_submissions(integer)
to authenticated,service_role;

notify pgrst,'reload schema';
