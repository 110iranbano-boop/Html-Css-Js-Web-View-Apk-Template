-- Cafe-book Simorgh: compatibility columns, secure profile views and transactional RPCs.
-- Run after the original 25-table schema in Supabase SQL Editor.
begin;

-- Columns consumed by the current Android/Web UI but missing from the initial schema.
alter table public.profiles add column if not exists phone text;
create unique index if not exists uq_profiles_phone on public.profiles(phone) where phone is not null;
alter table public.purchase_requests add column if not exists contact_phone text;
alter table public.purchase_requests add column if not exists note text;
alter table public.purchase_requests add column if not exists final_price_toman bigint;
alter table public.notifications add column if not exists read_at timestamptz;
alter table public.events add column if not exists location text;
alter table public.book_loans add column if not exists updated_at timestamptz not null default now();
alter table public.event_registrations add column if not exists attendance_points_snapshot integer not null default 0;
alter table public.purchase_requests drop constraint if exists purchase_requests_status_check;
alter table public.purchase_requests add constraint purchase_requests_status_check
  check (status in ('pending','registered','reviewing','approved','confirmed','awaiting_contact','ready','shipped','rejected','completed','cancelled'));

-- Keep profile phone and display name in sync with Supabase Auth.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id,display_name,phone)
  values(
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'display_name',''),
    new.phone
  )
  on conflict(id) do update
    set phone=coalesce(excluded.phone,public.profiles.phone),
        display_name=case when excluded.display_name<>'' then excluded.display_name else public.profiles.display_name end;
  insert into public.user_roles(user_id,role)
  values(new.id,'member')
  on conflict(user_id,role) do nothing;
  return new;
end;
$$;

-- Limited public author data: no phone, bio or other private profile fields.
create or replace view public.forum_public_profiles as
select p.id,p.display_name,p.username,p.avatar_url,p.is_suspended
from public.profiles p
where p.profile_visibility='members'
   or exists(select 1 from public.forum_topics t where t.user_id=p.id and t.status='published')
   or exists(select 1 from public.forum_comments c where c.user_id=p.id and c.status='published');
grant select on public.forum_public_profiles to authenticated;

create unique index if not exists uq_pending_borrow_request_per_user
on public.book_requests(user_id)
where request_type='borrow' and status='pending';

-- User requests a loan; stock is reserved only when the administrator approves.
create or replace function public.request_book_loan(p_book_id bigint,p_amount_toman bigint)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  b public.books%rowtype;
  v_id uuid;
begin
  if v_user is null then raise exception 'ابتدا وارد حساب شوید'; end if;
  if p_amount_toman is null or p_amount_toman < 20000 then raise exception 'پیشنهاد زیر ۲۰ هزار تومان تأیید نمی‌شود'; end if;
  if exists(select 1 from public.profiles where id=v_user and is_suspended) then raise exception 'حساب شما تعلیق است'; end if;
  select * into b from public.books where id=p_book_id for update;
  if not found or not b.is_active or b.book_type not in ('loan','both') or b.available_copies<1 then
    raise exception 'نسخه امانی این کتاب در حال حاضر موجود نیست';
  end if;
  if exists(select 1 from public.book_loans where user_id=v_user and status in ('active','overdue')) then
    raise exception 'تا زمان بازگرداندن کتاب قبلی امکان درخواست امانت جدید ندارید';
  end if;
  insert into public.book_requests(user_id,book_id,request_type,proposed_amount_toman)
  values(v_user,p_book_id,'borrow',p_amount_toman)
  returning id into v_id;
  return v_id;
end;
$$;

-- Group event registration with event row lock, preventing capacity overbooking.
create or replace function public.register_for_event(
  p_event_id bigint,
  p_registrant_name text,
  p_registrant_phone text,
  p_teammates jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  e public.events%rowtype;
  v_people integer;
  v_registered integer;
  v_registration uuid;
  p jsonb;
  n integer := 0;
begin
  if v_user is null then raise exception 'ابتدا وارد حساب شوید'; end if;
  if exists(select 1 from public.profiles where id=v_user and is_suspended) then raise exception 'حساب شما تعلیق است'; end if;
  select * into e from public.events where id=p_event_id for update;
  if not found or e.status<>'published' or e.event_type<>'timed' or not e.is_registration_open then
    raise exception 'ثبت‌نام این رویداد در دسترس نیست';
  end if;
  if jsonb_typeof(coalesce(p_teammates,'[]'::jsonb))<>'array' then raise exception 'ساختار همراهان معتبر نیست'; end if;
  if jsonb_array_length(coalesce(p_teammates,'[]'::jsonb))<>e.required_teammates then
    raise exception 'تعداد همراهان باید دقیقاً مطابق تعداد تعیین‌شده باشد';
  end if;
  if exists(select 1 from public.event_registrations where event_id=p_event_id and user_id=v_user and status='registered') then
    raise exception 'شما قبلاً در این رویداد ثبت‌نام کرده‌اید';
  end if;
  v_people:=1+jsonb_array_length(coalesce(p_teammates,'[]'::jsonb));
  select coalesce(sum(people_count),0)::integer into v_registered
  from public.event_registrations where event_id=p_event_id and status='registered';
  if e.capacity_people is not null and v_registered+v_people>e.capacity_people then raise exception 'ظرفیت رویداد تکمیل است'; end if;
  if nullif(trim(p_registrant_name),'') is null or p_registrant_phone !~ '^\+?[0-9]{10,15}$' then
    raise exception 'اطلاعات ثبت‌نام‌کننده معتبر نیست';
  end if;
  insert into public.event_registrations(
    event_id,user_id,registrant_name,registrant_phone,people_count,
    points_snapshot,attendance_points_snapshot,rules_version_snapshot,rules_text_snapshot
  ) values(p_event_id,v_user,trim(p_registrant_name),p_registrant_phone,v_people,
           case when e.award_points_when='registration' then e.points_on_registration else 0 end,
           case when e.award_points_when='attendance' then e.points_on_attendance else 0 end,
           e.rules_version,e.rules_text)
  returning id into v_registration;
  insert into public.event_registration_people(registration_id,person_role,full_name,phone,sort_order)
  values(v_registration,'registrant',trim(p_registrant_name),p_registrant_phone,0);
  for p in select * from jsonb_array_elements(coalesce(p_teammates,'[]'::jsonb)) loop
    n:=n+1;
    if nullif(trim(p->>'full_name'),'') is null or (p->>'phone') !~ '^\+?[0-9]{10,15}$' then
      raise exception 'نام یا شماره تماس یکی از همراهان معتبر نیست';
    end if;
    insert into public.event_registration_people(registration_id,person_role,full_name,phone,sort_order)
    values(v_registration,'teammate',trim(p->>'full_name'),p->>'phone',n);
  end loop;
  return v_registration;
end;
$$;

create or replace function public.cancel_event_registration(p_registration_id uuid)
returns public.event_registrations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  r public.event_registrations%rowtype;
  e public.events%rowtype;
  delta integer := 0;
begin
  select * into r from public.event_registrations where id=p_registration_id for update;
  if not found or r.user_id<>v_user or r.status<>'registered' then raise exception 'ثبت‌نام فعال پیدا نشد'; end if;
  select * into e from public.events where id=r.event_id;
  -- Cancellation after event start is intentionally blocked until the policy is decided.
  if e.starts_at is not null and now()>=e.starts_at then
    raise exception 'قانون لغو پس از شروع رویداد هنوز تعیین نشده است';
  end if;
  -- A one-calendar-day-before cancellation costs 5 points.
  if e.starts_at is not null and e.starts_at::date-current_date=1 then
    delta:=-5;
    insert into public.points_transactions(user_id,points_delta,reason_code,description,reference_type,reference_id,idempotency_key)
    values(v_user,-5,'event_cancellation','کسر امتیاز بابت لغو ثبت‌نام یک روز پیش از رویداد','event_registration',r.id::text,'event-cancel:'||r.id::text)
    on conflict(idempotency_key) do nothing;
  end if;
  update public.event_registrations set status='cancelled',cancelled_at=now() where id=r.id returning * into r;
  return r;
end;
$$;

create or replace function public.review_book_loan_request(
  p_request_id uuid,
  p_approve boolean,
  p_admin_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.book_requests%rowtype;
  b public.books%rowtype;
  loan_id uuid;
begin
  if not (public.is_super_admin() or public.has_permission('library.manage','update')) then raise exception 'دسترسی ندارید'; end if;
  select * into r from public.book_requests where id=p_request_id and request_type='borrow' for update;
  if not found or r.status<>'pending' then raise exception 'درخواست در وضعیت قابل بررسی نیست'; end if;
  if not p_approve then
    update public.book_requests set status='rejected',admin_note=p_admin_note,reviewed_by=auth.uid(),reviewed_at=now() where id=r.id;
    insert into public.notifications(user_id,title,body,notification_type)
    values(r.user_id,'نتیجه درخواست امانت','درخواست امانت شما رد شد.','book_request');
    return null;
  end if;
  if exists(select 1 from public.book_loans where user_id=r.user_id and status in ('active','overdue')) then raise exception 'کاربر یک امانت باز دارد'; end if;
  select * into b from public.books where id=r.book_id for update;
  if not found or not b.is_active or b.available_copies<1 then raise exception 'نسخه آزاد این کتاب موجود نیست'; end if;
  insert into public.book_loans(book_id,user_id,request_id,handed_over_at,current_due_at,status)
  values(b.id,r.user_id,r.id,now(),now()+interval '7 days','active')
  returning id into loan_id;
  update public.books set available_copies=available_copies-1 where id=b.id;
  update public.book_requests set status='approved',admin_note=p_admin_note,reviewed_by=auth.uid(),reviewed_at=now() where id=r.id;
  insert into public.notifications(user_id,title,body,notification_type)
  values(r.user_id,'درخواست امانت تأیید شد','امانت کتاب شما ثبت شد و مهلت اولیه بازگشت یک هفته است.','book_request');
  return loan_id;
end;
$$;

create or replace function public.review_loan_extension(
  p_extension_id uuid,
  p_approve boolean,
  p_admin_note text default null
)
returns public.loan_extensions
language plpgsql
security definer
set search_path = public
as $$
declare
  x public.loan_extensions%rowtype;
  l public.book_loans%rowtype;
  v_previous_due timestamptz;
begin
  if not (public.is_super_admin() or public.has_permission('library.manage','update')) then raise exception 'دسترسی ندارید'; end if;
  select * into x from public.loan_extensions where id=p_extension_id for update;
  if not found or x.status<>'pending' then raise exception 'درخواست تمدید قبلاً بررسی شده است'; end if;
  select * into l from public.book_loans where id=x.loan_id for update;
  if not found or l.status not in ('active','overdue') then raise exception 'امانت فعال نیست'; end if;
  if p_approve then
    v_previous_due:=l.current_due_at;
    update public.book_loans
      set current_due_at=v_previous_due+interval '7 days',
          status=case when v_previous_due+interval '7 days'>now() then 'active' else 'overdue' end,
          updated_at=now()
      where id=l.id returning * into l;
    update public.loan_extensions set status='approved',decided_by=auth.uid(),decided_at=now(),
      previous_due_at=v_previous_due,new_due_at=l.current_due_at,applied_at=now(),admin_note=p_admin_note where id=x.id;
  else
    update public.loan_extensions set status='rejected',decided_by=auth.uid(),decided_at=now(),admin_note=p_admin_note where id=x.id;
  end if;
  -- Migration 005 sends the status notification from the loan_extensions update trigger.
  select * into x from public.loan_extensions where id=x.id;
  return x;
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
set search_path = public
as $$
declare
  v_registration public.event_registrations%rowtype;
  a public.event_attendance%rowtype;
begin
  if not (public.is_super_admin() or public.has_permission('events.manage','update')) then
    raise exception 'دسترسی ندارید';
  end if;
  if p_attendance_status not in ('present','absent','excused','pending') then
    raise exception 'وضعیت حضور نامعتبر است';
  end if;
  select r.* into v_registration
  from public.event_registration_people ep
  join public.event_registrations r on r.id=ep.registration_id
  where ep.id=p_registration_person_id;
  if v_registration.id is null then raise exception 'فرد ثبت‌نام‌شده پیدا نشد'; end if;

  insert into public.event_attendance(registration_person_id,attendance_status,marked_by,marked_at,notes,penalty_applied)
  values(p_registration_person_id,p_attendance_status,auth.uid(),now(),p_notes,false)
  on conflict(registration_person_id) do update
    set attendance_status=excluded.attendance_status,marked_by=excluded.marked_by,
        marked_at=excluded.marked_at,notes=excluded.notes
  returning * into a;

  if p_attendance_status='absent' and not a.penalty_applied then
    insert into public.points_transactions(user_id,points_delta,reason_code,description,reference_type,reference_id,idempotency_key)
    values(v_registration.user_id,-10,'event_absence','کسر ۱۰ امتیاز بابت عدم حضور در رویداد','event_attendance',a.id::text,'event-absent:'||p_registration_person_id::text)
    on conflict(idempotency_key) do nothing;
    update public.event_attendance set penalty_applied=true where id=a.id returning * into a;
    insert into public.notifications(user_id,title,body,notification_type,reference_type,reference_id)
    values(v_registration.user_id,'عدم حضور در رویداد','۱۰ امتیاز بابت عدم حضور از امتیاز شما کسر شد.','event_attendance','event_registration',v_registration.id::text);
  elsif p_attendance_status='present' and v_registration.attendance_points_snapshot>0 then
    insert into public.points_transactions(user_id,points_delta,reason_code,description,reference_type,reference_id,idempotency_key)
    values(v_registration.user_id,v_registration.attendance_points_snapshot,'event_attendance','امتیاز بابت حضور تأییدشده در رویداد','event_registration',v_registration.id::text,'event-present:'||p_registration_person_id::text)
    on conflict(idempotency_key) do nothing;
  end if;
  return a;
end;
$$;

create or replace function public.settle_user_book_fines(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if not (public.is_super_admin() or public.has_permission('library.manage','update')) then raise exception 'دسترسی ندارید'; end if;
  update public.book_fines set status='settled',settled_at=now()
  where user_id=p_user_id and status='open';
  get diagnostics n=row_count;
  if not exists(select 1 from public.book_fines where user_id=p_user_id and status='open')
     and not exists(select 1 from public.book_loans where user_id=p_user_id and status in ('active','overdue')) then
    update public.profiles set is_suspended=false,suspension_reason=null,suspended_at=null,suspension_ends_at=null
    where id=p_user_id and suspension_reason='late_loan';
  end if;
  return n;
end;
$$;

-- Run daily from Supabase Cron. Fines begin after two weeks from the last due date
-- (one initial week plus one grace week); unique keys prevent duplicate deductions.
create or replace function public.apply_loan_late_fines()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.book_loans%rowtype;
  d date;
  n integer:=0;
  fine_id uuid;
begin
  for l in select * from public.book_loans
    where status in ('active','overdue') and current_due_at<now()
    for update
  loop
    if l.status='active' then
      update public.book_loans set status='overdue',updated_at=now() where id=l.id;
      insert into public.notifications(user_id,title,body,notification_type,reference_type,reference_id)
      values(l.user_id,'یادآوری بازگشت کتاب','مهلت یک‌هفته‌ای امانت شما به پایان رسیده است. لطفاً کتاب را بازگردانید یا درخواست تمدید ثبت کنید.','loan_due','book_loan',l.id::text);
    end if;
    -- One week initial loan + one week grace = fines start on day 15.
    if l.current_due_at < now() - interval '7 days' then
      for d in select generate_series((l.current_due_at::date+8)::timestamp,current_date::timestamp,interval '1 day')::date loop
        insert into public.book_fines(loan_id,user_id,fine_date,points_amount,reason,status)
        values(l.id,l.user_id,d,10,'late_return','open')
        on conflict(loan_id,fine_date) do nothing returning id into fine_id;
        if fine_id is not null then
          insert into public.points_transactions(user_id,points_delta,reason_code,description,reference_type,reference_id,idempotency_key)
          values(l.user_id,-10,'loan_late','کسر ۱۰ امتیاز بابت یک روز دیرکرد امانت','book_fine',fine_id::text,'loan-fine:'||l.id::text||':'||d::text)
          on conflict(idempotency_key) do nothing;
          n:=n+1; fine_id:=null;
        end if;
      end loop;
    end if;
    if l.handed_over_at<now()-interval '1 month' then
      update public.profiles set is_suspended=true,suspension_reason='late_loan',suspended_at=coalesce(suspended_at,now())
      where id=l.user_id;
    end if;
  end loop;
  return n;
end;
$$;

-- Replace the earlier trigger body so reference_id is stored as text and
-- positive points are awarded only when the event explicitly selects registration.
create or replace function public.award_event_registration_points()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.points_snapshot>0 then
    insert into public.points_transactions(user_id,points_delta,reason_code,description,reference_type,reference_id,idempotency_key)
    values(new.user_id,new.points_snapshot,'event_registration','امتیاز بابت ثبت‌نام در رویداد','event_registration',new.id::text,'event-registration:'||new.id::text)
    on conflict(idempotency_key) do nothing;
  end if;
  return new;
end;
$$;

-- Storage bucket for forum attachments.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('forum-images','forum-images',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;

drop policy if exists "forum images public read" on storage.objects;
create policy "forum images public read" on storage.objects
for select to anon,authenticated using(bucket_id='forum-images');

drop policy if exists "forum images owner upload" on storage.objects;
create policy "forum images owner upload" on storage.objects
for insert to authenticated
with check(bucket_id='forum-images' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists "forum images owner delete" on storage.objects;
create policy "forum images owner delete" on storage.objects
for delete to authenticated
using(bucket_id='forum-images' and ((storage.foldername(name))[1]=auth.uid()::text or public.has_permission('forum.moderate','delete') or public.is_super_admin()));

grant execute on function public.request_book_loan(bigint,bigint) to authenticated;
grant execute on function public.register_for_event(bigint,text,text,jsonb) to authenticated;
grant execute on function public.cancel_event_registration(uuid) to authenticated;
grant execute on function public.review_book_loan_request(uuid,boolean,text) to authenticated;
grant execute on function public.review_loan_extension(uuid,boolean,text) to authenticated;
grant execute on function public.mark_event_attendance(uuid,text,text) to authenticated;
grant execute on function public.settle_user_book_fines(uuid) to authenticated;

-- Align notification reference identifiers with the text column in the base schema.
create or replace function public.notify_request_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare v_title text; v_body text; v_kind text; v_user uuid;
begin
  if tg_table_name='book_requests' and new.request_type<>'borrow' and new.status is distinct from old.status then
    v_title := 'وضعیت درخواست کتاب';
    v_body := case new.status
      when 'approved' then 'درخواست شما تأیید شد.'
      when 'rejected' then coalesce(new.admin_note,'درخواست شما رد شد.')
      when 'completed' then 'درخواست شما تکمیل شد.'
      when 'cancelled' then 'درخواست شما لغو شد.'
      else 'وضعیت درخواست شما تغییر کرد.' end;
    insert into public.notifications(user_id,title,body,notification_type,reference_type,reference_id)
    values(new.user_id,v_title,v_body,'book_request','book_request',new.id::text);
  elsif tg_table_name='purchase_requests' and new.status is distinct from old.status then
    v_title := 'تغییر وضعیت درخواست خرید';
    v_body := case new.status
      when 'reviewing' then 'درخواست خرید شما در حال بررسی است.'
      when 'approved' then 'درخواست خرید شما تأیید شد.'
      when 'rejected' then coalesce(new.admin_note,'درخواست خرید شما رد شد.')
      when 'completed' then 'درخواست خرید شما تکمیل شد.'
      when 'cancelled' then 'درخواست خرید شما لغو شد.'
      when 'ready' then 'درخواست خرید شما آماده تحویل است.'
      when 'shipped' then 'درخواست خرید شما ارسال شد.'
      else 'وضعیت درخواست خرید شما تغییر کرد.' end;
    insert into public.notifications(user_id,title,body,notification_type,reference_type,reference_id)
    values(new.user_id,v_title,v_body,'purchase_request','purchase_request',new.id::text);
  elsif tg_table_name='loan_extensions' and new.status is distinct from old.status then
    select user_id into v_user from public.book_loans where id=new.loan_id;
    v_body := case when new.status='approved' then 'درخواست تمدید امانت شما تأیید شد و یک هفته به مهلت تحویل اضافه شد.'
                   else coalesce(new.admin_note,'درخواست تمدید امانت شما رد شد.') end;
    insert into public.notifications(user_id,title,body,notification_type,reference_type,reference_id)
    values(v_user,'نتیجه درخواست تمدید',v_body,'loan_extension','loan_extension',new.id::text);
  end if;
  return new;
end;
$$;

create or replace function public.send_book_due_reminders()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare l public.book_loans%rowtype; n integer := 0;
begin
  for l in
    select * from public.book_loans
    where returned_at is null and current_due_at::date <= current_date - 7
  loop
    if not exists(
      select 1 from public.notifications
      where user_id=l.user_id and notification_type='book_due_reminder'
        and reference_type='book_loan' and reference_id=l.id::text
    ) then
      insert into public.notifications(user_id,title,body,notification_type,reference_type,reference_id)
      values(l.user_id,'یادآوری تحویل کتاب','مهلت یک‌هفته‌ای امانت شما به پایان رسیده است. لطفاً برای تحویل یا درخواست تمدید اقدام کنید.','book_due_reminder','book_loan',l.id::text);
      n:=n+1;
    end if;
  end loop;
  return n;
end;
$$;

-- Tighten direct-table access: sensitive state transitions must use the RPCs above.
drop policy if exists "event_registrations_owner_insert" on public.event_registrations;
-- Exact policy names from the initial 25-table schema.
drop policy if exists "registrations cancel own" on public.event_registrations;
drop policy if exists "registrations admins update" on public.event_registrations;
drop policy if exists "loans admins manage" on public.book_loans;
drop policy if exists "extensions admins update" on public.loan_extensions;
drop policy if exists "fines admins manage" on public.book_fines;
drop policy if exists "points superadmin manage" on public.points_transactions;
drop policy if exists "attendance admins manage" on public.event_attendance;
drop policy if exists "book requests create own" on public.book_requests;
drop policy if exists "book requests admin update" on public.book_requests;
drop policy if exists "purchase requests create own" on public.purchase_requests;
drop policy if exists "event_registrations_owner_cancel_or_admin" on public.event_registrations;
drop policy if exists "event_people_owner_insert" on public.event_registration_people;
drop policy if exists "book_loans_admin_all" on public.book_loans;
drop policy if exists "loan_extensions_admin_update" on public.loan_extensions;
drop policy if exists "book_fines_admin_all" on public.book_fines;
drop policy if exists "points_admin_insert" on public.points_transactions;
drop policy if exists "event_attendance_admin_read_write" on public.event_attendance;

create policy "event_attendance_admin_read"
on public.event_attendance for select to authenticated
using (public.has_permission('events.manage','view') or public.is_super_admin());

drop policy if exists "book_requests_owner_insert" on public.book_requests;
create policy "book_requests_owner_insert"
on public.book_requests for insert to authenticated
with check (
  user_id=auth.uid()
  and request_type<>'borrow'
  and status='pending'
  and not exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_suspended)
);

drop policy if exists "book_requests_admin_update" on public.book_requests;
create policy "book_requests_admin_update"
on public.book_requests for update to authenticated
using (
  request_type<>'borrow'
  and (public.has_permission('library.manage','update') or public.is_super_admin())
)
with check (
  request_type<>'borrow'
  and (public.has_permission('library.manage','update') or public.is_super_admin())
);

create unique index if not exists uq_pending_loan_extension
on public.loan_extensions(loan_id) where status='pending';

-- Extend the existing profile protection trigger to protect the phone identifier too.
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid()=old.id
     and not public.is_super_admin()
     and not public.has_permission('users.manage','update') then
    if new.phone is distinct from old.phone
       or new.is_suspended is distinct from old.is_suspended
       or new.suspension_reason is distinct from old.suspension_reason
       or new.suspended_at is distinct from old.suspended_at
       or new.suspension_ends_at is distinct from old.suspension_ends_at
       or new.membership_level_id is distinct from old.membership_level_id
       or new.can_create_topic is distinct from old.can_create_topic then
      raise exception 'تغییر فیلدهای مدیریتی پروفایل مجاز نیست';
    end if;
  end if;
  return new;
end;
$$;

-- A member may create only a pending request for an actually available catalog item.
create or replace function public.validate_member_purchase_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_price bigint;
  v_active boolean;
  v_type text;
begin
  if auth.uid() is not null and auth.uid()=new.user_id
     and not public.is_super_admin()
     and not public.has_permission('store.manage','create')
     and not public.has_permission('library.manage','create') then
    if new.status<>'pending' or new.final_price_toman is not null
       or new.reviewed_by is not null or new.reviewed_at is not null then
      raise exception 'درخواست خرید جدید باید در وضعیت انتظار بررسی ثبت شود';
    end if;
    if new.book_id is not null then
      select title,sale_price_toman,is_active,book_type
      into v_name,v_price,v_active,v_type
      from public.books where id=new.book_id;
      if not found or not v_active or v_type not in ('sale','both') then raise exception 'کتاب برای فروش موجود نیست'; end if;
    else
      select name,price_toman,is_available
      into v_name,v_price,v_active
      from public.store_products where id=new.store_product_id;
      if not found or not v_active then raise exception 'محصول فروشگاه موجود نیست'; end if;
    end if;
    new.item_name_snapshot:=v_name;
    new.unit_price_toman_snapshot:=coalesce(v_price,0);
    new.contact_phone:=coalesce(new.contact_phone,(select phone from public.profiles where id=new.user_id));
  end if;
  return new;
end;
$$;

drop trigger if exists validate_member_purchase_request_trigger on public.purchase_requests;
create trigger validate_member_purchase_request_trigger
before insert on public.purchase_requests
for each row execute function public.validate_member_purchase_request();

drop policy if exists "purchase_requests_owner_insert" on public.purchase_requests;
create policy "purchase_requests_owner_insert"
on public.purchase_requests for insert to authenticated
with check (
  user_id=auth.uid() and status='pending' and final_price_toman is null
  and reviewed_by is null and reviewed_at is null
  and not exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_suspended)
);

grant execute on function public.apply_loan_late_fines() to service_role;

-- Keep the existing scheduler entry point documented in the original migrations.
create or replace function public.process_overdue_book_fines()
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.apply_loan_late_fines();
end;
$$;
revoke all on function public.process_overdue_book_fines() from public, anon, authenticated;
grant execute on function public.process_overdue_book_fines() to service_role;

commit;
