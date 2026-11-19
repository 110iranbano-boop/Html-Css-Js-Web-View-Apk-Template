# Project notes — Cafe Ketab Simorgh

## Architecture
- Android shell: Java WebView, loads `file:///android_asset/index.html`.
- Frontend: plain RTL HTML/CSS/JavaScript in `assets/`; do not add a Service Worker.
- API: Node.js 20 + Express in `backend/`.
- Database: PostgreSQL; schema in `backend/sql/schema.sql`.
- APK build: `.github/workflows/build-apk.yml` (Java 17, Gradle 8.7, AGP 8.5.2).

## Important constraints
- `assets/index.html` is the entry point; `assets/app-config.js` contains the API base URL.
- The API must use HTTPS in production; never use localhost in the Android build.
- Keep `localStorage` / DOM storage enabled for JWT session storage.
- Never commit `.env`, database credentials, or JWT secrets.
- Admin authorization must be enforced by the API, not only by hiding the admin tab.
- Keep the application ID and Java package aligned: `ir.simorgh.cafebook`.
- CI creates Gradle files and uses `sourceSets` to consume the legacy root structure; do not move Java/resources/assets without updating the workflow.
