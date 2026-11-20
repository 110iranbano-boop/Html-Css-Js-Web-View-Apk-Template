-- Enforce the per-action permissions configured in admin_permissions.
-- This migration changes policies only; it does not remove application data.
begin;

-- Membership levels
drop policy if exists "membership levels admins manage" on public.membership_levels;
create policy "membership levels insert" on public.membership_levels for insert to authenticated
with check (public.has_permission('users.manage','create'));
create policy "membership levels update" on public.membership_levels for update to authenticated
using (public.has_permission('users.manage','update'))
with check (public.has_permission('users.manage','update'));
create policy "membership levels delete" on public.membership_levels for delete to authenticated
using (public.has_permission('users.manage','delete'));

-- Cafe catalog
drop policy if exists "cafe categories manage" on public.cafe_categories;
create policy "cafe categories insert" on public.cafe_categories for insert to authenticated
with check (public.has_permission('cafe.manage','create'));
create policy "cafe categories update" on public.cafe_categories for update to authenticated
using (public.has_permission('cafe.manage','update')) with check (public.has_permission('cafe.manage','update'));
create policy "cafe categories delete" on public.cafe_categories for delete to authenticated
using (public.has_permission('cafe.manage','delete'));

drop policy if exists "cafe products manage" on public.cafe_products;
create policy "cafe products insert" on public.cafe_products for insert to authenticated
with check (public.has_permission('cafe.manage','create'));
create policy "cafe products update" on public.cafe_products for update to authenticated
using (public.has_permission('cafe.manage','update')) with check (public.has_permission('cafe.manage','update'));
create policy "cafe products delete" on public.cafe_products for delete to authenticated
using (public.has_permission('cafe.manage','delete'));

-- Library catalog
drop policy if exists "book categories manage" on public.book_categories;
create policy "book categories insert" on public.book_categories for insert to authenticated
with check (public.has_permission('library.manage','create'));
create policy "book categories update" on public.book_categories for update to authenticated
using (public.has_permission('library.manage','update')) with check (public.has_permission('library.manage','update'));
create policy "book categories delete" on public.book_categories for delete to authenticated
using (public.has_permission('library.manage','delete'));

drop policy if exists "books manage" on public.books;
create policy "books insert" on public.books for insert to authenticated
with check (public.has_permission('library.manage','create'));
create policy "books update" on public.books for update to authenticated
using (public.has_permission('library.manage','update')) with check (public.has_permission('library.manage','update'));
create policy "books delete" on public.books for delete to authenticated
using (public.has_permission('library.manage','delete'));

-- Store catalog
drop policy if exists "store categories manage" on public.store_categories;
create policy "store categories insert" on public.store_categories for insert to authenticated
with check (public.has_permission('store.manage','create'));
create policy "store categories update" on public.store_categories for update to authenticated
using (public.has_permission('store.manage','update')) with check (public.has_permission('store.manage','update'));
create policy "store categories delete" on public.store_categories for delete to authenticated
using (public.has_permission('store.manage','delete'));

drop policy if exists "store products manage" on public.store_products;
create policy "store products insert" on public.store_products for insert to authenticated
with check (public.has_permission('store.manage','create'));
create policy "store products update" on public.store_products for update to authenticated
using (public.has_permission('store.manage','update')) with check (public.has_permission('store.manage','update'));
create policy "store products delete" on public.store_products for delete to authenticated
using (public.has_permission('store.manage','delete'));

-- Events
drop policy if exists "events admins manage" on public.events;
create policy "events insert" on public.events for insert to authenticated
with check (public.has_permission('events.manage','create'));
create policy "events update" on public.events for update to authenticated
using (public.has_permission('events.manage','update')) with check (public.has_permission('events.manage','update'));
create policy "events delete" on public.events for delete to authenticated
using (public.has_permission('events.manage','delete'));

-- Forum moderation
drop policy if exists "forum topics moderators manage" on public.forum_topics;
create policy "forum topics moderators update" on public.forum_topics for update to authenticated
using (public.has_permission('forum.moderate','update')) with check (public.has_permission('forum.moderate','update'));
create policy "forum topics moderators delete" on public.forum_topics for delete to authenticated
using (public.has_permission('forum.moderate','delete'));

drop policy if exists "forum comments moderators manage" on public.forum_comments;
create policy "forum comments moderators update" on public.forum_comments for update to authenticated
using (public.has_permission('forum.moderate','update')) with check (public.has_permission('forum.moderate','update'));
create policy "forum comments moderators delete" on public.forum_comments for delete to authenticated
using (public.has_permission('forum.moderate','delete'));

commit;
