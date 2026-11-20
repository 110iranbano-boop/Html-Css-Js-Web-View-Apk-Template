# Simorgh API v2 foundation

This is an isolated backend foundation. It does not replace the live backend and does not run destructive operations during startup.

## Included
- PostgreSQL schema for accounts, profiles, points ledger, store, cafe, books/loans, events, forum, media, notifications and admin audit.
- Idempotent initializer that preserves existing data.
- Separate reset utility protected by explicit environment confirmations.
- Administrator seed utility using environment variables only.
- Minimal Express API with database health check.

## Environment
Set in the hosting panel, never in Git: DATABASE_URL, DB_SSL, JWT_SECRET, ADMIN_PHONE, ADMIN_INITIAL_PASSWORD and PORT. ADMIN_INITIAL_PASSWORD must be at least 12 characters. Optionally set CORS_ORIGIN.

## Non-destructive setup
From this directory run:
npm install
npm run check
npm run db:init
npm run admin:seed
npm start

## Destructive reset
Reset is never called by npm start or db:init. Back up and verify the target first. A deliberate reset requires ALLOW_DESTRUCTIVE_RESET=true and RESET_DATABASE_NAME exactly matching the database name in DATABASE_URL. Production additionally requires CONFIRM_PRODUCTION_RESET=I_UNDERSTAND_DATA_WILL_BE_DELETED. Run npm run db:reset only after checking the target, then remove all reset confirmation variables.

## Scope
This is a backend/database foundation, not the completed application. Authentication routes, admin CRUD APIs, storage integration, workflow rules, frontend integration and full tests must be completed before switching the live service or generating a final APK.
