-- Forum media and author display support. Additive; no user content is removed.
begin;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('forum-images','forum-images',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set
  public=true,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "forum images upload own folder" on storage.objects;
create policy "forum images upload own folder"
on storage.objects for insert to authenticated
with check (
  bucket_id='forum-images'
  and (storage.foldername(name))[1]=auth.uid()::text
);

drop policy if exists "forum images public read" on storage.objects;
create policy "forum images public read"
on storage.objects for select to authenticated
using (bucket_id='forum-images');

drop policy if exists "forum images delete own folder" on storage.objects;
create policy "forum images delete own folder"
on storage.objects for delete to authenticated
using (
  bucket_id='forum-images'
  and (storage.foldername(name))[1]=auth.uid()::text
);

create or replace view public.forum_public_profiles as
select distinct p.id,p.display_name,p.username,p.avatar_url,p.is_suspended
from public.profiles p
where exists(select 1 from public.forum_topics t where t.user_id=p.id and t.status<>'hidden')
   or exists(select 1 from public.forum_comments c where c.user_id=p.id and c.status='published');

grant select on public.forum_public_profiles to authenticated;

commit;
