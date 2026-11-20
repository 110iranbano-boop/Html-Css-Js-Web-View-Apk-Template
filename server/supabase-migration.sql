-- Migration for the Simorgh API integration.
-- Run this once in Supabase SQL Editor AFTER the 25-table schema has been installed.
begin;

alter table public.profiles
  add column if not exists phone text;

create unique index if not exists uq_profiles_phone
  on public.profiles(phone)
  where phone is not null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', '')
  )
  on conflict (id) do update
    set display_name = excluded.display_name,
        phone = coalesce(excluded.phone, public.profiles.phone);

  insert into public.user_roles (user_id, role)
  values (new.id, 'member')
  on conflict (user_id, role) do nothing;

  return new;
end;
$$;

-- Public media bucket. Keep private member data out of this bucket.
insert into storage.buckets (id, name, public)
values ('simorgh-media', 'simorgh-media', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "simorgh_media_public_read" on storage.objects;
create policy "simorgh_media_public_read"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'simorgh-media');

drop policy if exists "simorgh_media_admin_insert" on storage.objects;
create policy "simorgh_media_admin_insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'simorgh-media'
  and (
    public.has_role('super_admin')
    or public.has_permission('cafe.manage','update')
    or public.has_permission('library.manage','update')
    or public.has_permission('store.manage','update')
    or public.has_permission('events.manage','update')
    or public.has_permission('forum.manage','update')
  )
);

drop policy if exists "simorgh_media_admin_update" on storage.objects;
create policy "simorgh_media_admin_update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'simorgh-media'
  and (
    public.has_role('super_admin')
    or public.has_permission('cafe.manage','update')
    or public.has_permission('library.manage','update')
    or public.has_permission('store.manage','update')
    or public.has_permission('events.manage','update')
    or public.has_permission('forum.manage','update')
  )
)
with check (bucket_id = 'simorgh-media');

drop policy if exists "simorgh_media_admin_delete" on storage.objects;
create policy "simorgh_media_admin_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'simorgh-media'
  and (
    public.has_role('super_admin')
    or public.has_permission('cafe.manage','delete')
    or public.has_permission('library.manage','delete')
    or public.has_permission('store.manage','delete')
    or public.has_permission('events.manage','delete')
    or public.has_permission('forum.manage','delete')
  )
);

-- ثبت‌نام رویداد به‌صورت اتمیک برای جلوگیری از عبور هم‌زمان از ظرفیت
create or replace function public.register_event_atomic(
  p_event_id bigint,
  p_user_id uuid,
  p_name text,
  p_phone text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $
declare
  e public.events%rowtype;
  occupied integer;
  new_id uuid;
begin
  select * into e from public.events where id = p_event_id for update;
  if not found or e.status <> 'published' or e.event_type <> 'timed' or not e.is_registration_open then
    raise exception 'REGISTRATION_CLOSED';
  end if;
  if exists (select 1 from public.profiles where id = p_user_id and is_suspended) then
    raise exception 'ACCOUNT_SUSPENDED';
  end if;
  if exists (select 1 from public.event_registrations where event_id=p_event_id and user_id=p_user_id and status <> 'cancelled') then
    raise exception 'ALREADY_REGISTERED';
  end if;
  select coalesce(sum(people_count),0) into occupied
    from public.event_registrations where event_id=p_event_id and status <> 'cancelled';
  if e.capacity_people is not null and occupied >= e.capacity_people then
    raise exception 'EVENT_FULL';
  end if;
  insert into public.event_registrations(event_id,user_id,registrant_name,registrant_phone,people_count)
  values(p_event_id,p_user_id,p_name,p_phone,1) returning id into new_id;
  return new_id;
end;
$;

revoke all on function public.register_event_atomic(bigint,uuid,text,text) from public, anon, authenticated;
grant execute on function public.register_event_atomic(bigint,uuid,text,text) to service_role;

commit;
