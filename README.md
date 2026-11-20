# کافه‌کتاب سیمرغ

اپلیکیشن اندرویدی مبتنی بر HTML/CSS/JS و Capacitor با Supabase Auth، PostgreSQL، Row Level Security و Storage.

## معماری پروژه

- `www/`: رابط کاربری اپلیکیشن
- `www/config.js`: نشانی پروژه Supabase و کلید عمومی Publishable
- `www/supabase.js`: اتصال مستقیم امن کلاینت به Supabase و نگاشت عملیات برنامه به جدول‌ها و RPCها
- `supabase/migrations/`: مهاجرت‌های تکمیلی پایگاه داده
- `.github/workflows/build-apk.yml`: ساخت APK در GitHub Actions
- پوشه `server/` کد قدیمی PostgreSQL/JWT است و در مسیر اجرای نسخه Supabase استفاده نمی‌شود.

## تنظیم Supabase

پروژه Supabase در `www/config.js` تنظیم شده است. کلید قرارگرفته باید فقط کلید Publishable/anon باشد. هرگز کلید `service_role` یا Secret را در اپلیکیشن، فایل‌های عمومی یا GitHub قرار ندهید.

در Supabase > Authentication > Providers:
1. Phone را فعال کنید.
2. Phone confirmations را خاموش نگه دارید تا ورود با شماره و رمز عبور بدون OTP انجام شود.
3. ثبت‌نام با شماره تلفن باید با قالب بین‌المللی ایران (+98) به Supabase ارسال شود؛ رابط کاربری شماره 09 را به این قالب تبدیل می‌کند.

## مهاجرت‌های پایگاه داده

ساختار پایه ۲۵ جدول قبلاً در SQL Editor پروژه اجرا شده است. آن اسکریپت را دوباره اجرا نکنید. فایل‌های تکمیلی زیر را به ترتیب، هر کدام یک بار، در Supabase > SQL Editor اجرا کنید:

1. `supabase/migrations/002_simorgh_workflows.sql` — فیلدهای تکمیلی پروفایل، رویداد و خرید؛ لغو رویداد، جریمه‌ها و بازگشت کتاب.
2. `supabase/migrations/003_forum_media.sql` — فضای ذخیره‌سازی تصاویر تالار و نمای امن نام نویسندگان.
3. `supabase/migrations/004_atomic_library_events.sql` — ثبت/تأیید اتمیک امانت و ثبت امتیاز رویداد.
4. `supabase/migrations/005_notifications.sql` — اعلان تغییر وضعیت درخواست‌ها و یادآوری سررسید امانت.
5. `supabase/migrations/006_granular_admin_rls.sql` — اعمال مجوزهای جداگانه مشاهده/ایجاد/ویرایش/حذف برای مدیران بخش‌ها.
6. `supabase/migrations/007_event_capacity_view.sql` — نمایش ظرفیت کل رویداد بدون افشای اطلاعات ثبت‌نام‌کنندگان.
7. `supabase/migrations/008_app_completion.sql` — ثبت‌نام گروهی اتمیک، امتیازهای مشروط رویداد، تمدید/حضور/بازگشت کتاب، جریمه دیرکرد، تعلیق، محدودسازی عملیات حساس و اعتبارسنجی درخواست خرید.

این مهاجرت‌ها افزایشی‌اند و جدول یا داده‌ای را حذف نمی‌کنند.

## ساخت مدیر ارشد اولیه

1. ابتدا از داخل اپ یک حساب با شماره مدیر اصلی بسازید.
2. در Supabase > Authentication > Users شناسه UUID همان حساب را کپی کنید.
3. فقط یک بار دستور زیر را در SQL Editor اجرا کنید و UUID واقعی را جایگزین کنید:

```sql
insert into public.user_roles (user_id, role)
values ('UUID-حساب-مدیر', 'super_admin')
on conflict (user_id, role) do nothing;
```

پس از ورود مجدد، تب «دسترسی‌ها» در پنل مدیریت ظاهر می‌شود. مدیر ارشد می‌تواند برای مدیران دیگر نقش و مجوز مشاهده/ایجاد/ویرایش/حذف هر بخش را تعیین کند. برای مدیران بخش‌ها، مجوزهای `cafe.manage`، `library.manage`، `store.manage`، `events.manage`، `forum.moderate` و `users.manage` قابل استفاده‌اند.

## جریمه دیرکرد امانت

تابع `public.process_overdue_book_fines()` برای اجرای روزانه توسط زمان‌بند مورد اعتماد طراحی شده است. این تابع برای کلاینت عمومی مجوز اجرا ندارد. تابع `public.send_book_due_reminders()` نیز باید روزانه اجرا شود. هر دو تابع را از Supabase Cron یا یک Edge Function امن زمان‌بندی کنید. منطق تابع از روز پانزدهم پس از سررسید، روزانه ۱۰ امتیاز کسر می‌کند و پس از گذشت بیش از یک ماه از تحویل واقعی کتاب، حساب را تعلیق می‌کند.

## ساخت APK

در GitHub وارد Actions شوید و آخرین اجرای موفق workflow با نام **Build Simorgh Cafe APK** را باز کنید. Artifact با نام `Simorgh-Cafe-APK` را دانلود کنید. فایل خروجی `Simorgh-Cafe.apk` است.

نسخه فعلی Debug برای نصب و آزمایش است. انتشار عمومی نیازمند نسخه Release و امضای معتبر است.
