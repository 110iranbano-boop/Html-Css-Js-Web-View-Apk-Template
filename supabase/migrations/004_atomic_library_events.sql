-- Atomic library operations and event points ledger.
begin;

create unique index if not exists one_pending_borrow_request_per_user
on public.book_requests(user_id)
where request_type='borrow' and status='pending';

create or replace function public.request_book_loan(p_book_id bigint,p_amount_toman bigint)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare v_book public.books; v_id uuid;
begin
  if auth.uid() is null then raise exception 'ابتدا وارد حساب شوید'; end if;
  if public.is_account_suspended(auth.uid()) then raise exception 'حساب شما تعلیق شده است'; end if;
  if p_amount_toman < 20000 then raise exception 'حداقل مبلغ پیشنهادی ۲۰٬۰۰۰ تومان است'; end if;
  if exists(select 1 from public.book_loans where user_id=auth.uid() and returned_at is null) then
    raise exception 'تا زمان تحویل کتاب امانتی قبلی امکان درخواست جدید ندارید';
  end if;
  if exists(select 1 from public.book_requests where user_id=auth.uid() and request_type='borrow' and status='pending') then
    raise exception 'یک درخواست امانت در حال بررسی دارید';
  end if;
  select * into v_book from public.books
  where id=p_book_id and is_active and book_type in ('loan','both')
  for update;
  if not found then raise exception 'کتاب امانی پیدا نشد'; end if;
  if v_book.available_copies<1 then raise exception 'نسخه امانی موجود نیست'; end if;
  insert into public.book_requests(user_id,book_id,request_type,proposed_amount_toman)
  values(auth.uid(),p_book_id,'borrow',p_amount_toman) returning id into v_id;
  return v_id;
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
set search_path = public, auth
as $$
declare v_req public.book_requests; v_book public.books; v_loan uuid;
begin
  if not (public.has_permission('library.manage','update') or public.is_super_admin()) then
    raise exception 'مجوز مدیریت کتابخانه ندارید';
  end if;
  select * into v_req from public.book_requests where id=p_request_id for update;
  if not found or v_req.request_type<>'borrow' then raise exception 'درخواست امانت پیدا نشد'; end if;
  if v_req.status<>'pending' then raise exception 'این درخواست قبلاً بررسی شده است'; end if;

  if p_approve then
    select * into v_book from public.books where id=v_req.book_id for update;
    if not found or v_book.available_copies<1 then raise exception 'نسخه امانی موجود نیست'; end if;
    if exists(select 1 from public.book_loans where user_id=v_req.user_id and returned_at is null) then
      raise exception 'این کاربر هنوز کتاب امانتی قبلی را تحویل نداده است';
    end if;
    insert into public.book_loans(book_id,user_id,request_id,handed_over_at,current_due_at,status)
    values(v_req.book_id,v_req.user_id,v_req.id,now(),now()+interval '7 days','active')
    returning id into v_loan;
    update public.books set available_copies=available_copies-1 where id=v_req.book_id;
    update public.book_requests set status='approved',admin_note=p_admin_note,reviewed_by=auth.uid(),reviewed_at=now()
    where id=p_request_id;
    insert into public.notifications(user_id,title,body,notification_type,reference_type,reference_id)
    values(v_req.user_id,'درخواست امانت تأیید شد','درخواست شما تأیید شد. مهلت اولیه امانت یک هفته است.','loan','book_loan',v_loan::text);
  else
    update public.book_requests set status='rejected',admin_note=p_admin_note,reviewed_by=auth.uid(),reviewed_at=now()
    where id=p_request_id;
    insert into public.notifications(user_id,title,body,notification_type,reference_type,reference_id)
    values(v_req.user_id,'درخواست امانت رد شد',coalesce(p_admin_note,'درخواست امانت شما تأیید نشد.'),'loan_request','book_request',p_request_id::text);
  end if;
  return coalesce(v_loan,p_request_id);
end;
$$;

-- Award positive points only when the event's saved policy explicitly says registration.
create or replace function public.award_event_registration_points()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.points_snapshot>0 then
    insert into public.points_transactions(user_id,points_delta,reason_code,description,reference_type,reference_id,idempotency_key)
    values(new.user_id,new.points_snapshot,'event_registration','امتیاز ثبت‌نام رویداد','event_registration',new.id::text,'event_registration:'||new.id::text)
    on conflict(idempotency_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists award_event_registration_points_trigger on public.event_registrations;
create trigger award_event_registration_points_trigger
after insert on public.event_registrations
for each row execute procedure public.award_event_registration_points();

grant execute on function public.request_book_loan(bigint,bigint) to authenticated;
grant execute on function public.review_book_loan_request(uuid,boolean,text) to authenticated;

commit;
