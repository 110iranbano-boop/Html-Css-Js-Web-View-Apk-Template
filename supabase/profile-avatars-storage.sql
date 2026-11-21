-- Supabase setup for the curated Simorgh profile-avatar gallery.
-- Run this script once in Supabase SQL Editor before using the in-app avatar picker.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-avatars', 'profile-avatars', true, 5242880, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.profile_avatar_options (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  image_path text not null unique,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.profile_avatar_options enable row level security;

drop policy if exists "Authenticated users can view active profile avatars" on public.profile_avatar_options;
create policy "Authenticated users can view active profile avatars"
on public.profile_avatar_options for select
to authenticated
using (is_active = true);

drop policy if exists "Public can view profile avatar images" on storage.objects;
create policy "Public can view profile avatar images"
on storage.objects for select
to public
using (bucket_id = 'profile-avatars');

-- After uploading each image to Storage > profile-avatars, register it here:
-- insert into public.profile_avatar_options (title, image_path, sort_order)
-- values ('نام تصویر', 'avatars/avatar-01.png', 1);
