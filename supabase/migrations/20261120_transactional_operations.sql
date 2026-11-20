-- کافه‌کتاب سیمرغ: توابع تراکنشی تکمیلی برای عملیات حساس
-- این فایل را پس از اجرای schema اصلی در Supabase SQL Editor اجرا کنید.
begin;

create or replace function public.register_event_atomic(
  p_event_id bigint,
  p_user_id uuid,
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
  e public.events%rowtype;
  v_people_count integer;
  v_registered integer;
  v_registration_id uuid;
  v_person jsonb;
  v_index integer := 0;
begin
  select * into e from public.events where id = p_event_id for update;
  if not found or e.status <> 'published' or e.event_type <> 'timed' or not e.is_registration_open then
    raise exception 'ثبت‌نام این رویداد در دسترس نیست';
  end if;
  if exists(select 1 from public.profiles where id=p_user_id and is_suspended) then
    raise exception 'حساب کاربر تعلیق است';
  end if;
  if exists(select 1 from public.event_registrations where event_id=p_event_id and user_id=p_user_id and status='registered') then
    raise exception 'کاربر قبلاً ثبت‌نام کرده است';
  end if;
  if jsonb_typeof(coalesce(p_teammates,'[]'::jsonb)) <> 'array' then
    raise exception 'ساختار همراهان معتبر نیست';
  end if;
  if jsonb_array_length(coalesce(p_teammates,'[]'::jsonb)) <> e.required_teammates then
    raise exception 'تعداد همراهان با تعداد تعیین‌شده رویداد برابر نیست';
  end if;
  v_people_count := 1 + jsonb_array_length(coalesce(p_teammates,'[]'::jsonb));
  select coalesce(sum(people_count),0)::integer into v_registered
  from public.event_registrations
  where event_id=p_event_id and status='registered';
  if e.capacity_people is not null and v_registered + v_people_count > e.capacity_people then
    raise exception 'ظرفیت رویداد تکمیل است';
  end if;
  insert into public.event_registrations(
    event_id,user_id,registrant_name,registrant_phone,people_count,
    points_snapshot,rules_version_snapshot,rules_text_snapshot
  ) values (
    p_event_id,p_user_id,p_registrant_name,p_registrant_phone,v_people_count,
    e.points_on_registration,e.rules_version,e.rules_text
  ) returning id into v_registration_id;

  insert into public.event_registration_people(registration_id,person_role,full_name,phone,sort_order)
  values(v_registration_id,'registrant',p_registrant_name,p_registrant_phone,0);

  for v_person in select * from jsonb_array_elements(coalesce(p_teammates,'[]'::jsonb)) loop
    v_index := v_index + 1;
    if nullif(trim(v_person->>'full_name'),'') is null or (v_person->>'phone') !~ '^09[0-9]{9}$' then
      raise exception 'اطلاعات یکی از همراهان معتبر نیست';
    end if;
    insert into public.event_registration_people(registration_id,person_role,full_name,phone,sort_order)
    values(v_registration_id,'teammate',trim(v_person->>'full_name'),v_person->>'phone',v_index);
  end loop;
  return v_registration_id;
end;
$$;

create or replace function public.return_book_atomic(p_book_id bigint)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.book_loans%rowtype;
begin
  select * into l from public.book_loans
  where book_id=p_book_id and status in ('active','overdue')
  for update;
  if not found then raise exception 'امانت فعالی برای این کتاب وجود ندارد'; end if;
  update public.book_loans set status='returned', returned_at=now() where id=l.id;
  update public.books
  set available_copies=least(total_copies,available_copies+1)
  where id=p_book_id;
  return l.id;
end;
$$;

create or replace function public.approve_book_borrow_request(p_request_id uuid,p_admin_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.book_requests%rowtype;
  b public.books%rowtype;
  l_id uuid;
begin
  select * into r from public.book_requests where id=p_request_id for update;
  if not found or r.request_type <> 'borrow' or r.status <> 'pending' then
    raise exception 'درخواست امانت در وضعیت قابل تأیید نیست';
  end if;
  if exists(select 1 from public.book_loans where user_id=r.user_id and status in ('active','overdue')) then
    raise exception 'کاربر یک امانت باز دارد';
  end if;
  select * into b from public.books where id=r.book_id for update;
  if not found or not b.is_active or b.available_copies < 1 then
    raise exception 'نسخه آزاد این کتاب موجود نیست';
  end if;
  insert into public.book_loans(book_id,user_id,request_id,handed_over_at,current_due_at,status)
  values(b.id,r.user_id,r.id,now(),now()+interval '7 days','active')
  returning id into l_id;
  update public.books set available_copies=available_copies-1 where id=b.id;
  update public.book_requests set status='approved',reviewed_by=p_admin_id,reviewed_at=now() where id=r.id;
  return l_id;
end;
$$;

grant execute on function public.register_event_atomic(bigint,uuid,text,text,jsonb) to service_role;
grant execute on function public.return_book_atomic(bigint) to service_role;
grant execute on function public.approve_book_borrow_request(uuid,uuid) to service_role;

commit;
