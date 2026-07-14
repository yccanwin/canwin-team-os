-- Static catalog contract for the production alignment migration.

do $$
declare
  policy_definition text;
  policy_name text;
begin
  foreach policy_name in array array[
    'uploaders or captains update photos',
    'uploaders or captains delete photos',
    'photo owners delete own team photos'
  ] loop
    select lower(coalesce(qual, '') || ' ' || coalesce(with_check, ''))
      into policy_definition
    from pg_policies
    where policyname = policy_name
      and ((schemaname = 'public' and tablename = 'photos')
        or (schemaname = 'storage' and tablename = 'objects'));

    if policy_definition is null then
      raise exception 'missing photo policy: %', policy_name;
    end if;
    if position('current_profile_role' in policy_definition) = 0 then
      raise exception 'photo policy does not use current_profile_role: %', policy_name;
    end if;
    if position('has_role' in policy_definition) > 0 then
      raise exception 'legacy has_role remains in photo policy: %', policy_name;
    end if;
  end loop;
end $$;

select 'photo_policy_role_helper_alignment_ok' as result;
