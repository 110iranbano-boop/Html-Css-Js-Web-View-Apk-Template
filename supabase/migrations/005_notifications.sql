-- User-facing status notifications and loan due reminders.
begin;

create or replace function public.notify_request_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare v_title text; v_body text; v_kind text;
begin
  if tg_table_name='book_requests' and new.status is distinct from old.status then
    v_title := case when new.request_type='borrow' then 'وضعیت درخواست امانت' else 'وضعیت درخواست کتاب' end;
    v_body := case new.status
      when 'approved' then 'درخواست شما تأیید شد.'
      when 'rejected' then coalesce(new.admin_note,'درخواست شما رد شد.')
      when 'completed' then 'درخواست شما تکمیل شد.'
      when 'cancelled' then 'درخواست شما لغو شد.'
      else 'وضعیت درخواست شما تغییر کرد.' end;
    v_kind := 'book_request';
    insert into public.notifications(user_id,title,body,notification_type,reference_type,reference_id)
    values(new.user_id,v_title,v_body,v_kind,'book_request',new.id::text);
  elsif tg_table_name='purchase_requests' and new.status is distinct from old.status then
    v_title := 'تغییر وضعیت درخواست خرید';
    v_body := case new.status
      when 'reviewing' then 'درخواست خرید شما در حال بررسی است.'
      when 'approved' then 'درخواست خرید شما تأیید شد.'
      when 'rejected' then coalesce(new.admin_note,'درخواست خرید شما رد شد.')
      when 'completed' then 'درخواست خرید شما تکمیل شد.'
      when 'cancelled' then 'درخواست خرید شما لغو شد.'
      else 'وضعیت درخواست خرید شما تغییر کرد.' end;
    insert into public.notifications(user_id,title,body,notification_type,reference_type,reference_id)
    values(new.user_id,v_title,v_body,'purchase_request','purchase_request',new.id::text);
  elsif tg_table_name='loan_extensions' and new.status is distinct from old.status then
    select user_id into v_title from public.book_loans where id=new.loan_id;
    v_body := case when new.status='approved' then 'درخواست تمدید امانت شما تأیید شد و یک هفته به مهلت تحویل اضافه شد.'
                   else coalesce(new.admin_note,'درخواست تمدید امانت شما رد شد.') end;
    insert into public.notifications(user_id,title,body,notification_type,reference_type,reference_id)
    values(v_title,'نتیجه درخواست تمدید',v_body,'loan_extension','loan_extension',new.id::text);
  end if;
  return new;
end;
$$;

drop trigger if exists notify_book_request_status on public.book_requests;
create trigger notify_book_request_status after update on public.book_requests
for each row execute procedure public.notify_request_status_change();

drop trigger if exists notify_purchase_request_status on public.purchase_requests;
create trigger notify_purchase_request_status after update on public.purchase_requests
for each row execute procedure public.notify_request_status_change();

drop trigger if exists notify_loan_extension_status on public.loan_extensions;
create trigger notify_loan_extension_status after update on public.loan_extensions
for each row execute procedure public.notify_request_status_change();

create or replace function public.send_book_due_reminders()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare l public.book_loans; n integer := 0;
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

grant execute on function public.send_book_due_reminders() to service_role;
grant execute on function public.process_overdue_book_fines() to service_role;

commit;
