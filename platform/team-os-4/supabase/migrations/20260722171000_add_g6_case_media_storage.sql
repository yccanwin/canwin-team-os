-- G6 case media storage boundary.
-- Objects are written only by the trusted server boundary. Browser roles receive
-- no INSERT, UPDATE, or DELETE policy for this bucket.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'team-os-4-case-media',
  'team-os-4-case-media',
  false,
  307200,
  array['image/png', 'image/jpeg', 'image/webp']::text[]
);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'team-os-4-public-cases',
  'team-os-4-public-cases',
  false,
  307200,
  array['image/png', 'image/jpeg', 'image/webp']::text[]
);

create or replace function private.validate_case_media_storage_object()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_expected_stem text;
  v_object_mime text;
  v_object_size_text text;
  v_object_size bigint;
begin
  v_expected_stem := new.company_id::text || '/' || new.case_id::text || '/' || new.media_type;

  if not (
    (new.mime_type = 'image/png' and new.object_path = v_expected_stem || '.png')
    or (new.mime_type = 'image/jpeg' and new.object_path in (v_expected_stem || '.jpg', v_expected_stem || '.jpeg'))
    or (new.mime_type = 'image/webp' and new.object_path = v_expected_stem || '.webp')
  ) then
    raise exception 'case media path must be company/case/slot with an extension matching its MIME type'
      using errcode = '23514';
  end if;

  select
    o.metadata ->> 'mimetype',
    o.metadata ->> 'size'
  into v_object_mime, v_object_size_text
  from storage.objects as o
  where o.bucket_id = 'team-os-4-case-media'
    and o.name = new.object_path;

  if not found then
    raise exception 'case media metadata requires an existing object in the case media bucket'
      using errcode = '23503';
  end if;

  if v_object_mime is distinct from new.mime_type then
    raise exception 'case media MIME type does not match the stored object'
      using errcode = '23514';
  end if;

  if v_object_size_text is null or v_object_size_text !~ '^[0-9]+$' then
    raise exception 'case media stored object has no valid byte size'
      using errcode = '23514';
  end if;

  v_object_size := v_object_size_text::bigint;

  if v_object_size <> new.size_bytes
     or (new.media_type = 'logo' and v_object_size > 204800)
     or (new.media_type = 'display_code' and v_object_size > 307200) then
    raise exception 'case media byte size violates its slot limit or metadata declaration'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

revoke all on function private.validate_case_media_storage_object() from public;

create trigger case_media_requires_valid_storage_object
before insert or update of company_id, case_id, media_type, object_path, mime_type, size_bytes
on public.case_media
for each row execute function private.validate_case_media_storage_object();

grant select on table storage.objects to anon, authenticated;

create policy team_os_4_public_case_media_read
on storage.objects
for select
to anon, authenticated
using (
  bucket_id = 'team-os-4-public-cases'
  and exists (
    select 1
    from public.case_media as cm
    join public.cases as c
      on c.id = cm.case_id
     and c.company_id = cm.company_id
    where cm.object_path = storage.objects.name
      and c.status = 'published'
      and c.authorization_valid
  )
);

create policy team_os_4_case_media_admin_preview
on storage.objects
for select
to authenticated
using (
  bucket_id = 'team-os-4-case-media'
  and exists (
    select 1
    from public.case_media as cm
    where cm.object_path = storage.objects.name
      and private.is_company_admin(cm.company_id)
  )
);

comment on function private.validate_case_media_storage_object() is
  'Binds case media metadata to one fixed company/case/slot object and verifies MIME and slot-specific byte limits.';

comment on policy team_os_4_public_case_media_read on storage.objects is
  'Only trusted-server copies in the separate public case directory are anonymously readable while their case remains published and authorized.';
