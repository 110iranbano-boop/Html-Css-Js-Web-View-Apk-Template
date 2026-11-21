-- Simorgh loyalty system: configurable earning rules, independent membership progress,
-- spendable points, membership discounts, rewards and atomic redemption.
-- Apply after migrations 002-010. Existing points_transactions remain valid and
-- are classified as "both" so legacy balances are preserved.
begin;

alter table public.points_transactions
  add column if not exists points_bucket text not null default 'both',
  add column if not exists rule_code text;

alter table public.points_transactions
  drop constraint if exists points_transactions_points_bucket_check;
alter table public.points_transactions
  add constraint points_transactions_points_bucket_check
  check (points_bucket in ('both','membership','spendable'));

create index if not exists idx_points_transactions_user_bucket_created
  on public.points_transactions(user_id, points_bucket, created_at desc);
create unique index if not exists uq_points_transactions_rule_reference
  on public.points_transactions(user_id, rule_code, reference_type, reference_id)
  where rule_code is not null and reference_id is not null;

alter table public.membership_levels
  add column if not exists discount_percent numeric(5,2) not null default 0,
  add column if not exists is_active boolean not null default true;
alter table public.membership_levels
  drop constraint if exists membership_levels_discount_percent_check;
alter table public.membership_levels
  add constraint membership_levels_discount_percent_check
  check (discount_percent >= 0 and discount_percent <= 100);

create table if not exists public.point_rules (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  description text,
  points integer not null check (points > 0),
  is_active boolean not null default true,
  requires_approval boolean not null default true,
  max_per_user integer,
  period_days integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((max_per_user is null and period_days is null) or
         (max_per_user > 0 and period_days > 0))
);

create table if not exists public.rewards (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  image_url text,
  points_cost integer not null check (points_cost > 0),
  stock_quantity integer check (stock_quantity is null or stock_quantity >= 0),
  per_user_limit integer check (per_user_limit is null or per_user_limit > 0),
  requires_approval boolean not null default true,
  is_active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table if not exists public.reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reward_id uuid not null references public.rewards(id),
  points_cost integer not null check (points_cost > 0),
  status text not null default 'pending'
    check (status in ('pending','approved','ready','delivered','rejected','cancelled')),
  admin_note text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_reward_redemptions_user_created
  on public.reward_redemptions(user_id, created_at desc);
create index if not exists idx_reward_redemptions_status_created
  on public.reward_redemptions(status, created_at desc);

-- Legacy points count toward both membership progress and spendable balance.
-- Reward purchases are recorded as spendable-only transactions.
create or replace view public.user_loyalty_balance
with (security_invoker = true) as
select
  p.id as user_id,
  coalesce(sum(t.points_delta) filter
    (where t.points_bucket in ('both','membership')),0)::bigint as membership_points,
  coalesce(sum(t.points_delta) filter
    (where t.points_bucket in ('both','spendable')),0)::bigint as spendable_points
from public.profiles p
left join public.points_transactions t on t.user_id=p.id
group by p.id;

grant select on public.user_loyalty_balance to authenticated;

alter table public.point_rules enable row level security;
alter table public.rewards enable row level security;
alter table public.reward_redemptions enable row level security;

drop policy if exists "point rules visible to signed in users" on public.point_rules;
create policy "point rules visible to signed in users"
on public.point_rules for select to authenticated
using (is_active or public.is_super_admin() or public.has_permission('users.manage','view'));

drop policy if exists "point rules admins manage" on public.point_rules;
create policy "point rules admins manage"
on public.point_rules for all to authenticated
using (public.is_super_admin() or public.has_permission('users.manage','update'))
with check (public.is_super_admin() or public.has_permission('users.manage','update'));

drop policy if exists "active rewards visible" on public.rewards;
create policy "active rewards visible"
on public.rewards for select to authenticated
using ((is_active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()))
       or public.is_super_admin() or public.has_permission('store.manage','view'));

drop policy if exists "reward admins manage" on public.rewards;
create policy "reward admins manage"
on public.rewards for all to authenticated
using (public.is_super_admin() or public.has_permission('store.manage','update'))
with check (public.is_super_admin() or public.has_permission('store.manage','update'));

drop policy if exists "members read own reward redemptions" on public.reward_redemptions;
create policy "members read own reward redemptions"
on public.reward_redemptions for select to authenticated
using (user_id=auth.uid() or public.is_super_admin() or public.has_permission('store.manage','view'));

-- No direct member insert/update policies: all redemption state changes use RPC.
drop policy if exists "reward redemption admins read" on public.reward_redemptions;
create policy "reward redemption admins read"
on public.reward_redemptions for select to authenticated
using (public.is_super_admin() or public.has_permission('store.manage','view'));

create or replace function public.refresh_member_level(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_points bigint;
  v_level uuid;
begin
  select coalesce(sum(points_delta),0)::bigint into v_points
  from public.points_transactions
  where user_id=p_user_id and points_bucket in ('both','membership');

  select id into v_level
  from public.membership_levels
  where is_active and min_points <= v_points
  order by min_points desc, sort_order desc
  limit 1;

  update public.profiles
  set membership_level_id=v_level
  where id=p_user_id;
end;
$$;

create or replace function public.on_points_transaction_refresh_level()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_member_level(new.user_id);
  return new;
end;
$$;

drop trigger if exists points_refresh_member_level on public.points_transactions;
create trigger points_refresh_member_level
after insert on public.points_transactions
for each row execute function public.on_points_transaction_refresh_level();

create or replace function public.award_loyalty_points(
  p_user_id uuid,
  p_rule_code text,
  p_reference_type text,
  p_reference_id text,
  p_description text default null
)
returns public.points_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.point_rules%rowtype;
  v_tx public.points_transactions%rowtype;
  v_count integer;
begin
  if auth.uid() is null or not
    (public.is_super_admin() or public.has_permission('users.manage','update')) then
    raise exception 'دسترسی اعطای امتیاز ندارید';
  end if;
  if p_user_id is null or nullif(trim(p_reference_type),'') is null or nullif(trim(p_reference_id),'') is null then
    raise exception 'اطلاعات مرجع فعالیت کامل نیست';
  end if;

  select * into r from public.point_rules where code=p_rule_code and is_active for share;
  if not found then raise exception 'قانون امتیازدهی فعال پیدا نشد'; end if;

  if r.max_per_user is not null then
    select count(*) into v_count
    from public.points_transactions
    where user_id=p_user_id and rule_code=r.code
      and created_at >= now() - make_interval(days => r.period_days);
    if v_count >= r.max_per_user then raise exception 'سقف دریافت امتیاز این فعالیت تکمیل شده است'; end if;
  end if;

  insert into public.points_transactions(
    user_id,points_delta,reason_code,description,reference_type,reference_id,
    idempotency_key,points_bucket,rule_code
  ) values (
    p_user_id,r.points,r.code,coalesce(nullif(trim(p_description),''),r.title),
    p_reference_type,p_reference_id,
    'loyalty:'||r.code||':'||p_user_id::text||':'||p_reference_type||':'||p_reference_id,
    'both',r.code
  )
  on conflict(idempotency_key) do nothing
  returning * into v_tx;

  if v_tx.id is null then
    select * into v_tx from public.points_transactions
    where idempotency_key='loyalty:'||r.code||':'||p_user_id::text||':'||p_reference_type||':'||p_reference_id;
  end if;
  return v_tx;
end;
$$;

create or replace function public.redeem_loyalty_reward(p_reward_id uuid)
returns public.reward_redemptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  r public.rewards%rowtype;
  v_balance bigint;
  v_used integer;
  v_redemption public.reward_redemptions%rowtype;
begin
  if v_user is null then raise exception 'ابتدا وارد حساب شوید'; end if;

  perform 1 from public.profiles where id=v_user for update;
  select * into r from public.rewards
  where id=p_reward_id and is_active
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
  for update;
  if not found then raise exception 'این جایزه در حال حاضر فعال نیست'; end if;

  select coalesce(sum(points_delta),0)::bigint into v_balance
  from public.points_transactions
  where user_id=v_user and points_bucket in ('both','spendable');
  if v_balance < r.points_cost then raise exception 'امتیاز قابل‌خرج کافی نیست'; end if;

  if r.stock_quantity is not null and r.stock_quantity < 1 then
    raise exception 'موجودی این جایزه تمام شده است';
  end if;

  if r.per_user_limit is not null then
    select count(*) into v_used from public.reward_redemptions
    where user_id=v_user and reward_id=r.id and status <> 'rejected';
    if v_used >= r.per_user_limit then raise exception 'محدودیت دریافت این جایزه برای شما تکمیل شده است'; end if;
  end if;

  insert into public.reward_redemptions(user_id,reward_id,points_cost,status)
  values(v_user,r.id,r.points_cost,case when r.requires_approval then 'pending' else 'approved' end)
  returning * into v_redemption;

  insert into public.points_transactions(
    user_id,points_delta,reason_code,description,reference_type,reference_id,
    idempotency_key,points_bucket
  ) values (
    v_user,-r.points_cost,'reward_redemption','مصرف امتیاز برای: '||r.title,
    'reward_redemption',v_redemption.id::text,
    'reward-redemption:'||v_redemption.id::text,'spendable'
  );

  if r.stock_quantity is not null then
    update public.rewards set stock_quantity=stock_quantity-1,updated_at=now()
    where id=r.id;
  end if;
  return v_redemption;
end;
$$;

create or replace function public.review_loyalty_redemption(
  p_redemption_id uuid,
  p_approve boolean,
  p_admin_note text default null
)
returns public.reward_redemptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_redemption public.reward_redemptions%rowtype;
  v_reward public.rewards%rowtype;
begin
  if not (public.is_super_admin() or public.has_permission('store.manage','update')) then
    raise exception 'دسترسی ندارید';
  end if;

  select * into v_redemption from public.reward_redemptions
  where id=p_redemption_id and status='pending' for update;
  if not found then raise exception 'درخواست در وضعیت قابل بررسی نیست'; end if;

  select * into v_reward from public.rewards where id=v_redemption.reward_id for update;
  if p_approve then
    update public.reward_redemptions
    set status='approved',admin_note=p_admin_note,reviewed_by=auth.uid(),reviewed_at=now()
    where id=v_redemption.id returning * into v_redemption;
  else
    insert into public.points_transactions(
      user_id,points_delta,reason_code,description,reference_type,reference_id,
      idempotency_key,points_bucket
    ) values (
      v_redemption.user_id,v_redemption.points_cost,'reward_refund',
      'بازگشت امتیاز بابت رد درخواست جایزه','reward_redemption',v_redemption.id::text,
      'reward-refund:'||v_redemption.id::text,'spendable'
    ) on conflict(idempotency_key) do nothing;

    if v_reward.stock_quantity is not null then
      update public.rewards set stock_quantity=stock_quantity+1,updated_at=now()
      where id=v_reward.id;
    end if;
    update public.reward_redemptions
    set status='rejected',admin_note=p_admin_note,reviewed_by=auth.uid(),reviewed_at=now()
    where id=v_redemption.id returning * into v_redemption;
  end if;
  return v_redemption;
end;
$$;

create or replace function public.mark_loyalty_reward_delivered(p_redemption_id uuid)
returns public.reward_redemptions
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.reward_redemptions%rowtype;
begin
  if not (public.is_super_admin() or public.has_permission('store.manage','update')) then
    raise exception 'دسترسی ندارید';
  end if;
  update public.reward_redemptions
  set status='delivered',delivered_at=now(),reviewed_by=auth.uid(),reviewed_at=now()
  where id=p_redemption_id and status in ('approved','ready')
  returning * into v_row;
  if not found then raise exception 'درخواست آماده تحویل پیدا نشد'; end if;
  return v_row;
end;
$$;

revoke all on function public.award_loyalty_points(uuid,text,text,text,text) from public, anon;
revoke all on function public.redeem_loyalty_reward(uuid) from public, anon;
revoke all on function public.review_loyalty_redemption(uuid,boolean,text) from public, anon;
revoke all on function public.mark_loyalty_reward_delivered(uuid) from public, anon;
grant execute on function public.award_loyalty_points(uuid,text,text,text,text) to authenticated;
grant execute on function public.redeem_loyalty_reward(uuid) to authenticated;
grant execute on function public.review_loyalty_redemption(uuid,boolean,text) to authenticated;
grant execute on function public.mark_loyalty_reward_delivered(uuid) to authenticated;

-- Seed configurable earning rules only when they do not already exist.
insert into public.point_rules(code,title,description,points,is_active,requires_approval)
values
 ('profile_complete','تکمیل پروفایل','تکمیل اطلاعات ضروری حساب',20,true,false),
 ('book_borrow','امانت گرفتن کتاب','ثبت امانت معتبر',10,true,false),
 ('book_return_on_time','بازگرداندن به‌موقع کتاب','ثبت بازگشت در موعد مقرر',10,true,false),
 ('event_attendance','حضور در رویداد','پس از ثبت حضور توسط مسئول رویداد',20,true,false),
 ('workshop_attendance','شرکت در کارگاه','پس از تأیید حضور',25,true,false),
 ('book_review','نقد یا معرفی کتاب','پس از تأیید محتوای منتشرشده',30,true,true),
 ('member_referral','معرفی عضو جدید','پس از ثبت‌نام و احراز شرط معرفی',30,true,true),
 ('volunteer_activity','مشارکت داوطلبانه','بر اساس نوع فعالیت و تأیید مسئول',30,true,true)
on conflict(code) do nothing;

commit;
