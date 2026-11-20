# Simorgh database compatibility audit

Status: audit only; the production backend has not yet been replaced.

## Confirmed database contract
The deployed PostgreSQL database uses the 36-table schema discussed with the project owner. The current legacy `server/server.js` and `server/schema.sql` are from an older data model and must not be used against that database.

Examples of incompatible legacy references:
- `users.full_name`, `users.role`, `users.member_code` do not exist; identity and roles are split across `users`, `profiles`, `roles`, and `user_roles`.
- `books.type`, `books.price`, `books.status` do not exist; use `book_type`, `sale_price`, and `availability`.
- `art_products`, `purchase_requests`, `purchase_request_items`, and `book_requests` are not part of the current schema.
- Cafe availability is `cafe_items.is_available`; catalog categories are separate category tables.
- Event times use `events.starts_at`; registration requires an accepted `event_rule_versions` row and attendee rows.
- Authorization is based on role/permission relation tables, not a `users.role` column.

## Deployment safety rules
1. Do not execute the legacy `server/schema.sql` on the deployed database.
2. Do not run any reset script or drop/recreate the public schema.
3. Do not create an administrator by inserting a `role` column into `users`.
4. Back up the current backend before replacing it.
5. Verify API routes against the real schema before switching the Chabokan start command.
6. Keep the existing database and its data unchanged during application deployment.

## Business rules already confirmed
- Cafe is display-only; no cafe ordering flow.
- Store and book purchase requests use their own request tables and price snapshots.
- Positive event points are awarded only after attendance is confirmed.
- Late cancellation within 24 hours: 5 points deduction.
- No-show: 10 points deduction (apply when absence is recorded).
- After-start cancellation is penalized, but the amount must be configured before deductions are applied.
- Loan term begins at actual pickup; admin approval alone does not start the loan.
- Loan extensions require admin approval and add seven days each time.
- Profiles are public by default; users can change visibility.
