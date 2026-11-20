# فرهنگسرای سیمرغ

اپلیکیشن اندرویدی مبتنی بر HTML/CSS/JS و Capacitor، به‌همراه API با Express و پایگاه داده PostgreSQL.

## ساختار
- `www/`: رابط کاربری اپ
- `www/config.js`: نشانی API مورد استفاده APK
- `server/`: سرور Node.js و فایل ساخت جداول PostgreSQL
- `.github/workflows/build-apk.yml`: ساخت APK در GitHub Actions

## استقرار API روی چابکان
در تنظیمات سرویس Node.js این مقادیر را تنظیم کنید:
- مسیر/Root Directory: `server`
- نسخه Node.js: ترجیحاً 20
- Build/Install Command: `npm install`
- Start Command: `npm start`

متغیرهای محیطی (Environment Variables):
- `DATABASE_URL`: آدرس اتصال PostgreSQL که از پنل پایگاه داده دریافت می‌شود.
- `JWT_SECRET`: یک مقدار تصادفی محرمانه و طولانی؛ حداقل ۳۲ کاراکتر. نمونه تولید در Node: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `PGSSL`: اگر اتصال PostgreSQL ارائه‌شده توسط چابکان به SSL نیاز دارد، `true`؛ در غیر این صورت `false`.
- `PORT`: معمولاً توسط پلتفرم تنظیم می‌شود؛ اگر چابکان مقدار اختصاصی اعلام کرده، همان مقدار را نگه دارید.
- `ADMIN_PHONE` و `ADMIN_PASSWORD`: اختیاری؛ فقط اگر می‌خواهید مدیر اولیه هنگام شروع سرور به‌صورت خودکار ساخته شود. هر دو را با هم وارد کنید.

سرور در زمان شروع، فایل `schema.sql` را اجرا می‌کند و جدول‌های لازم را می‌سازد؛ بنابراین اجرای جداگانهٔ `npm run db:init` برای استقرار معمول لازم نیست. برای اجرای دستی:
```bash
npm run db:init
```

پس از Deploy، این نشانی را باز کنید:
```
https://دامنه-API-شما/api/health
```
پاسخ مورد انتظار:
```json
{"ok":true}
```

## ساخت مدیر
ابتدا با شمارهٔ موردنظر از داخل اپ ثبت‌نام کنید. سپس در محیط اجرای سرور، از پوشهٔ `server` اجرا کنید:
```bash
npm run make-admin -- 09123456789
```
این دستور نقش همان شماره را در جدول `users` به `admin` تغییر می‌دهد.

## نشانی API در APK
فایل `www/config.js` باید شامل نشانی دقیق API و مسیر `/api` باشد. در حال حاضر:
```js
window.APP_CONFIG = { API_BASE: "https://nodejs-brjrka.chbkn.dev/api" };
```
اگر دامنهٔ چابکان تغییر کرد، همین مقدار را با دامنهٔ جدید جایگزین کنید و APK را دوباره بسازید.

## ساخت APK
در GitHub وارد تب Actions شوید و آخرین اجرای موفق workflow با نام **Build Simorgh Cafe APK** را باز کنید. فایل Artifact با نام `Simorgh-Cafe-APK` را دانلود کنید؛ فایل داخل آن `Simorgh-Cafe.apk` است.

نسخهٔ فعلی APK از نوع Debug است و برای نصب و آزمایش مناسب است. انتشار عمومی در مارکت‌ها به نسخهٔ Release و امضای معتبر نیاز دارد.

## نکات امنیتی
- فایل‌های `.env`، رمز پایگاه داده و `JWT_SECRET` را در GitHub قرار ندهید.
- `JWT_SECRET` و `DATABASE_URL` فقط در Environment Variables سرویس چابکان ثبت شوند.
- API باید از HTTPS استفاده کند.
- `cleartext` و `allowMixedContent` در تنظیمات Capacitor خاموش هستند.
