-- Replace legacy ALL policies with action-specific user-management permissions.
-- Super admins retain full access through the explicit role check.

begin;

-- Membership levels already have separate INSERT / UPDATE / DELETE policies
-- created by 006_granular_admin_rls.sql. Remove the legacy ALL policy.
drop policy if exists "membership_levels_admin_all" on public.membership_levels;

-- Forum permissions are created, updated, and removed from the super-admin
-- access-management screen. Keep each database operation independently gated.
drop policy if exists "forum_permissions_admin_manage" on public.forum_permissions;

create policy "forum_permissions_admin_insert"
on public.forum_permissions
for insert to authenticated
with check (
  public.has_permission('users.manage','create')
  or public.is_super_admin()
);

create policy "forum_permissions_admin_update"
on public.forum_permissions
for update to authenticated
using (
  public.has_permission('users.manage','update')
  or public.is_super_admin()
)
with check (
  public.has_permission('users.manage','update')
  or public.is_super_admin()
);

create policy "forum_permissions_admin_delete"
on public.forum_permissions
for delete to authenticated
using (
  public.has_permission('users.manage','delete')
  or public.is_super_admin()
);

commit;
