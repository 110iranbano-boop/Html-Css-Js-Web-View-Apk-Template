# فرهنگسرای سیمرغ

اپلیکیشن اندرویدی مبتنی بر HTML/CSS/JS و Capacitor با API مبتنی بر Node.js و Supabase.

## ساختار
- `www/`: رابط کاربری اپلیکیشن
- `www/config.js`: نشانی API مورد استفاده APK
- `server/server.js`: API و اتصال به Supabase Auth و Database
- `server/supabase-migration.sql`: تغییرات تکمیلی لازم پس از اجرای ساختار اصلی دیتابیس
- `.github/workflows/build-apk.yml`: ساخت APK

## راه‌اندازی Supabase

۱. در Supabase SQL Editor فایل ساختار اصلی `simorgh_supabase_schema.sql` را اجرا کنید (همان فایل ۲۵ جدولی که قبلاً در پروژه اجرا شده است).

۲. سپس محتوای فایل `server/supabase-migration.sql` را در SQL Editor اجرا کنید. این مرحله ستون شماره همراه را به پروفایل اضافه می‌کند و Storage bucket رسانه‌های عمومی را می‌سازد.

۳. در Supabase از بخش Project Settings → API این مقادیر را بردارید:
- Project URL
- anon / publishable key
- service_role / secret key

کلید service role فقط باید در متغیرهای محرمانه سرور باشد؛ هرگز آن را در فایل‌های `www/`، APK یا GitHub قرار ندهید.

## استقرار API روی چابکان

- Root Directory: `server`
- Node.js: نسخه ۲۰ یا بالاتر
- Install Command: `npm install`
- Start Command: `npm start`

متغیرهای محیطی سرور:

| متغیر | مقدار |
|---|---|
| `SUPABASE_URL` | Project URL از Supabase |
| `SUPABASE_ANON_KEY` | کلید anon / publishable |
| `SUPABASE_SERVICE_ROLE_KEY` | کلید محرمانه service_role / secret |
| `ADMIN_PHONE` | شماره مدیر اولیه، مانند 09123456789 |
| `ADMIN_PASSWORD` | رمز مدیر اولیه، حداقل ۸ کاراکتر |
| `ADMIN_NAME` | نام نمایشی مدیر (اختیاری) |
| `PORT` | توسط چابکان تنظیم می‌شود |

با تنظیم هم‌زمان `ADMIN_PHONE` و `ADMIN_PASSWORD`، سرور در اولین راه‌اندازی حساب مدیر ارشد را در Supabase Auth ایجاد می‌کند و نقش `super_admin` می‌دهد. پس از اطمینان از ساخت مدیر، می‌توانید این دو متغیر را از تنظیمات سرور حذف کنید؛ نقش مدیر در دیتابیس باقی می‌ماند.

## ورود با شماره موبایل و رمز عبور

ظاهر فرم ورود تغییر نکرده است. برای استفاده از ورود بدون پیامک، API شماره را در سمت سرور به یک شناسه ایمیل داخلی با دامنه رزروشده `.invalid` تبدیل می‌کند و احراز هویت را با Supabase Auth انجام می‌دهد. این شناسه ایمیل داخلی به کاربر نمایش داده نمی‌شود و هیچ SMS یا Twilio لازم نیست. رمز عبور فقط در Supabase Auth نگهداری می‌شود؛ اپلیکیشن آن را در جدول پروفایل ذخیره نمی‌کند.

## API و APK

نشانی API در `www/config.js` قرار دارد و باید دامنه واقعی سرویس چابکان همراه با `/api` باشد. پس از Deploy، این نشانی را باز کنید:

```
https://دامنه-API-شما/api/health
```

پاسخ مورد انتظار:

```json
{"ok":true,"service":"supabase"}
```

برای ساخت APK از GitHub → Actions، workflow ساخت APK را اجرا کنید و Artifact با نام `Simorgh-Cafe-APK` را دریافت کنید.

## نکات مهم

- این شاخه، نسخه آزمایشی یکپارچه‌سازی Supabase است؛ تا زمان بررسی و تأیید، آن را با `main` ادغام نکنید.
- داده‌های کاربران، پروفایل‌ها، کتاب‌ها، کافه، فروشگاه، رویدادها، درخواست‌ها، اعلان‌ها و مجوزها در Supabase نگهداری می‌شوند.
- خرید کتاب و محصولات فروشگاه در این نسخه درخواست خرید حضوری است؛ درگاه پرداخت آنلاین اضافه نشده است.
- عملیات حساس چندجدولی باید با توابع تراکنشی سمت پایگاه داده اجرا شود. تابع ثبت‌نام رویداد در فایل migration برای جلوگیری از عبور هم‌زمان از ظرفیت اضافه شده است.
- فایل‌های رسانه‌ای در Storage نگهداری می‌شوند و دیتابیس فقط مسیر آن‌ها را ذخیره می‌کند.
- کلید service role و رمز مدیر را در GitHub commit نکنید.
