# 🦅 کافه کتاب سیمرغ

اپ کافه + کتابخانه: فرانت‌اند تک‌فایلی (`www/`)، سرور Express + PostgreSQL (`server/`) و ساخت APK اندروید با Capacitor و GitHub Actions.

```
www/index.html       رابط کاربری
www/config.js        آدرس سرور (API_BASE) ← حتماً پر کن
server/              بک‌اند (server.js, schema.sql, scripts/)
capacitor.config.json
.github/workflows/build-apk.yml   ساخت خودکار APK
```

## ۱) راه‌اندازی سرور (چابکان یا هر هاست Node)

```bash
cd server
cp .env.example .env      # و مقدارها را پر کن (هر متغیر در یک خط)
npm install
npm run db:init           # ساخت جدول‌ها (اگر جدول‌ها از قبل هست لازم نیست)
npm start
```

- `JWT_SECRET`: با این دستور بساز: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- اولین ادمین: ابتدا در اپ با شماره‌ات ثبت‌نام کن، بعد `npm run make-admin -- 09123456789`
- تست سلامت: `GET /api/health`
- فایل `.env` را هرگز روی گیت‌هاب نگذار (در `.gitignore` هست).

## ۲) آدرس سرور در اپ

`www/config.js` را باز کن و بنویس:

```js
window.APP_CONFIG = { API_BASE: "https://دامنه-سرور-تو/api" };
```

یا در گیت‌هاب: Settings ← Secrets and variables ← Actions ← **Variables** ← متغیر `API_BASE`
(workflow خودش داخل config.js می‌گذارد).

> بهتر است سرور HTTPS داشته باشد. تنظیمات `cleartext` و `allowMixedContent` در
> `capacitor.config.json` فقط برای این است که اگر فعلاً سرور `http://` است اپ کار کند؛
> بعد از گرفتن HTTPS هر دو را `false` کن.

## ۳) گرفتن APK

۱. پروژه را روی گیت‌هاب push کن (شاخه‌ی `main`).
۲. تب **Actions** ← workflow به نام *Build APK* ← بعد از پایان، فایل **simorgh-cafe-apk** را از Artifacts دانلود کن (داخلش `app-debug.apk` است).

ساخت محلی (نیاز به Node 20، JDK 21 و Android SDK):

```bash
npm install
npx cap add android && npx cap sync android
cd android && ./gradlew assembleDebug
# خروجی: android/app/build/outputs/apk/debug/app-debug.apk
```

نسخه‌ی debug برای نصب و تست کافی است. برای انتشار در مارکت‌ها باید نسخه‌ی release با keystore امضا شود.
