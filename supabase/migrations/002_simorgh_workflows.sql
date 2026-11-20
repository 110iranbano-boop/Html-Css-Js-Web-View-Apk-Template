-- Supabase compatibility and workflow completion migration for Simorgh.
-- Safe additive migration: does not drop tables, columns, or user data.
begin;

alter table public.profiles add column if not exists phone text;
alter table public.events add column if not exists location text;
alter table public.purchase_requests add column if not exists contact_phone text;
alter table public.purchase_requests add column if not exists note text;
alter table public.purchase_requests add column if not exists final_price_toman bigint
  check (final_price_toman is null or final_price_toman >= 0);
alter table public.store_products add column if not exists allow_custom boolean not null default false;
alter table public.store_products add column if not exists stock_status text not null default 'in_stock'
  check (stock_status in ('in_stock','made_to_order','out'));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.profiles (id, display_name, phone)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name',''),
             nullif(new.raw_user_meta_data ->> 'full_name','')),
    new.phone
  )
  on conflict (id) do update
    set phone = coalesce(public.profiles.phone, excluded.phone),
        display_name = coalesce(public.profiles.display_name, excluded.display_name);

  insert into public.user_roles (user_id, role)
  values (new.id, 'member')
  on conflict (user_id, role) do nothing;
  return new;
end;
$$;

update public.profiles p
set phone = u.phone
from auth.users u
where u.id = p.id and p.phone is null and u.phone is not null;

drop policy if exists "profiles select own or visible" on public.profiles;
create policy "profiles select own or visible"
on public.profiles for select to authenticated
using (
  id = auth.uid()
  or public.is_super_admin()
  or public.has_permission('users.manage','view')
  or public.has_permission('library.manage','view')
  or public.has_permission('store.manage','view')
  or public.has_permission('events.manage','view')
  or public.has_permission('forum.moderate','view')
  or (profile_visibility = 'members' and not is_suspended)
);

-- Atomic cancellation and penalty ledger. Cancellation after event start remains
-- intentionally undecided, as required by the product specification.
create or replace function public.cancel_event_registration(p_registration_id uuid)
returns public.event_registrations
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_reg public.event_registrations;
  v_event public.events;
  v_penalty integer := 0;
begin
  select * into v_reg from public.event_registrations
  where id = p_registration_id for update;
  if not found or v_reg.user_id <> auth.uid() then
    raise exception 'ثبت‌نام پیدا نشد';
  end if;
  if v_reg.status <> 'registered' then raise exception 'این ثبت‌نام فعال نیست'; end if;

  select * into v_event from public.events where id = v_reg.event_id;
  if v_event.starts_at is not null and now() >= v_event.starts_at then
    raise exception 'قانون لغو پس از شروع رویداد هنوز تعیین نشده است';
  end if;
  if v_event.starts_at is not null and v_event.starts_at <= now() + interval '1 day' then
    v_penalty := 5;
  end if;

  update public.event_registrations
  set status='cancelled', cancelled_at=now(),
      penalty_applied=(v_penalty > 0), cancellation_reason='user_cancelled'
  where id=p_registration_id returning * into v_reg;

  if v_penalty > 0 then
    insert into public.points_transactions(user_id,points_delta,reason_code,description,reference_type,reference_id,idempotency_key)
    values(v_reg.user_id,-v_penalty,'event_cancel_1day','لغو ثبت‌نام یک روز پیش از رویداد','event_registration',p_registration_id::text,'event_cancel:'||p_registration_id::text)
    on conflict (idempotency_key) do nothing;
  end if;
  return v_reg;
end;
$$;

create or replace function public.mark_event_attendance(
  p_registration_person_id uuid,
  p_attendance_status text,
  p_notes text default null
)
returns public.event_attendance
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_person public.event_registration_people;
  v_reg public.event_registrations;
  v_event public.events;
  v_att public.event_attendance;
begin
  if not (public.has_permission('events.manage','update') or public.is_super_admin()) then
    raise exception 'مجوز مدیریت رویدادها ندارید';
  end if;
  if p_attendance_status not in ('present','absent','excused','pending') then
    raise exception 'وضعیت حضور نامعتبر است';
  end if;
  select * into v_person from public.event_registration_people where id=p_registration_person_id;
  if not found then raise exception 'فرد ثبت‌نام‌شده پیدا نشد'; end if;
  select * into v_reg from public.event_registrations where id=v_person.registration_id;
  select * into v_event from public.events where id=v_reg.event_id;

  insert into public.event_attendance(registration_person_id,attendance_status,marked_by,marked_at,notes)
  values(p_registration_person_id,p_attendance_status,auth.uid(),now(),p_notes)
  on conflict(registration_person_id) do update
    set attendance_status=excluded.attendance_status,marked_by=auth.uid(),marked_at=now(),notes=excluded.notes
  returning * into v_att;

  if p_attendance_status='absent' and not v_att.penalty_applied then
    insert into public.points_transactions(user_id,points_delta,reason_code,description,reference_type,reference_id,idempotency_key)
    values(v_reg.user_id,-10,'event_absence','عدم حضور در رویداد','event_registration',v_reg.id::text,'event_absence:'||p_registration_person_id::text)
    on conflict(idempotency_key) do nothing;
    update public.event_attendance set penalty_applied=true where id=v_att.id returning * into v_att;
    insert into public.notifications(user_id,title,body,notification_type,reference_type,reference_id)
    values(v_reg.user_id,'کسر امتیاز عدم حضور','به دلیل عدم حضور در رویداد، ۱۰ امتیاز از حساب شما کسر شد.','points','event_registration',v_reg.id::text);
  elsif p_attendance_status='present' and v_event.award_points_when='attendance' and v_event.points_on_attendance>0 then
    insert into public.points_transactions(user_id,points_delta,reason_code,description,reference_type,reference_id,idempotency_key)
    values(v_reg.user_id,v_event.points_on_attendance,'event_attendance','حضور تأییدشده در رویداد','event_registration',v_reg.id::text,'event_present:'||p_registration_person_id::text)
    on conflict(idempotency_key) do nothing;
  end if;
  return v_att;
end;
$$;

create or replace function public.return_book(p_loan_id uuid)
returns public.book_loans
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_loan public.book_loans;
begin
  if not (public.has_permission('library.manage','update') or public.is_super_admin()) then
    raise exception 'مجوز مدیریت کتابخانه ندارید';
  end if;
  select * into v_loan from public.book_loans where id=p_loan_id for update;
  if not found then raise exception 'امانت پیدا نشد'; end if;
  if v_loan.returned_at is not null then raise exception 'این کتاب قبلاً تحویل گرفته شده است'; end if;

  update public.book_loans set returned_at=now(),status='returned',updated_at=now()
  where id=p_loan_id returning * into v_loan;
  update public.books set available_copies=least(total_copies,available_copies+1),updated_at=now()
  where id=v_loan.book_id;
  if not exists(select 1 from public.book_loans where user_id=v_loan.user_id and returned_at is null)
     and not exists(select 1 from public.book_fines where user_id=v_loan.user_id and status='open') then
    update public.profiles set is_suspended=false,suspension_reason=null,suspended_at=null,suspension_ends_at=null
    where id=v_loan.user_id;
  end if;
  return v_loan;
end;
$$;

create or replace function public.settle_user_book_fines(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare v_count integer;
begin
  if not (public.has_permission('library.manage','update') or public.is_super_admin()) then
    raise exception 'مجوز مدیریت کتابخانه ندارید';
  end if;
  update public.book_fines set status='settled',settled_at=now()
  where user_id=p_user_id and status='open';
  get diagnostics v_count = row_count;
  if not exists(select 1 from public.book_loans where user_id=p_user_id and returned_at is null)
     and not exists(select 1 from public.book_fines where user_id=p_user_id and status='open') then
    update public.profiles set is_suspended=false,suspension_reason=null,suspended_at=null,suspension_ends_at=null
    where id=p_user_id;
  end if;
  return v_count;
end;
$$;

-- Called by a trusted scheduler (not by the public client) once per day.
create or replace function public.process_overdue_book_fines()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  l public.book_loans;
  d date;
  v_fine_start date;
  n integer := 0;
begin
  for l in
    select * from public.book_loans
    where returned_at is null and status in ('active','overdue')
  loop
    if now() > l.handed_over_at + interval '1 month' then
      update public.profiles set is_suspended=true,
        suspension_reason='کتاب امانی بیش از یک ماه تحویل داده نشده است',
        suspended_at=coalesce(suspended_at,now())
      where id=l.user_id;
    end if;
    v_fine_start := greatest(l.handed_over_at::date + 15, l.current_due_at::date + 1);
    if current_date >= v_fine_start then
      for d in select generate_series(v_fine_start,current_date,interval '1 day')::date
      loop
        insert into public.book_fines(loan_id,user_id,fine_date,points_amount,reason)
        values(l.id,l.user_id,d,10,'late_return')
        on conflict(loan_id,fine_date) do nothing;
        if found then
          insert into public.points_transactions(user_id,points_delta,reason_code,description,reference_type,reference_id,idempotency_key)
          values(l.user_id,-10,'book_late_return','جریمه دیرکرد امانت کتاب','book_loan',l.id::text,'book_late:'||l.id::text||':'||d::text)
          on conflict(idempotency_key) do nothing;
          n := n + 1;
        end if;
      end loop;
      update public.book_loans set status='overdue',updated_at=now() where id=l.id and status='active';
    end if;
  end loop;
  return n;
end;
$$;

grant execute on function public.cancel_event_registration(uuid) to authenticated;
grant execute on function public.mark_event_attendance(uuid,text,text) to authenticated;
grant execute on function public.return_book(uuid) to authenticated;
grant execute on function public.settle_user_book_fines(uuid) to authenticated;
revoke all on function public.process_overdue_book_fines() from public, anon, authenticated;

commit;
