-- Remove legacy permissive ALL policies that bypass per-action catalog permissions.
-- Keep the explicit INSERT / UPDATE / DELETE policies from 006_granular_admin_rls.sql.
begin;

drop policy if exists "book_categories_admin" on public.book_categories;
drop policy if exists "books_admin" on public.books;
drop policy if exists "cafe_categories_admin" on public.cafe_categories;
drop policy if exists "cafe_products_admin" on public.cafe_products;
drop policy if exists "store_categories_admin" on public.store_categories;
drop policy if exists "store_products_admin" on public.store_products;
drop policy if exists "events_admin_all" on public.events;

-- Migration 006 defines separate create/update/delete policies for membership levels.
-- Remove the legacy ALL policy so those per-action checks are effective.
drop policy if exists "membership_levels_admin_all" on public.membership_levels;

-- Forum permission assignments are managed by users with users.manage/update.
-- Keep that management capability, but do not grant SELECT through an ALL policy;
-- the existing read policy remains responsible for visibility.
drop policy if exists "forum_permissions_admin_manage" on public.forum_permissions;
create policy "forum_permissions_admin_insert"
on public.forum_permissions
for insert to authenticated
with check (public.has_permission('users.manage','update'));

create policy "forum_permissions_admin_update"
on public.forum_permissions
for update to authenticated
using (public.has_permission('users.manage','update'))
with check (public.has_permission('users.manage','update'));

create policy "forum_permissions_admin_delete"
on public.forum_permissions
for delete to authenticated
using (public.has_permission('users.manage','update'));

-- Event participant rows are created by the register_for_event RPC.
-- Admins may update participant details, but the update permission alone
-- must not implicitly grant direct INSERT or DELETE on this table.
drop policy if exists "event_people_admin_update" on public.event_registration_people;
create policy "event_people_admin_update"
on public.event_registration_people
for update to authenticated
using (
  public.has_permission('events.manage','update')
  or public.is_super_admin()
)
with check (
  public.has_permission('events.manage','update')
  or public.is_super_admin()
);

commit;
