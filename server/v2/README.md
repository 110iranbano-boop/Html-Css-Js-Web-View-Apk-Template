# Simorgh v2 database and backend foundation

This PostgreSQL schema is designed for a new/empty public schema. It is idempotent and does not drop tables or delete data.

## Decisions incorporated
- Event cancellation after the event starts: a penalty record is supported. The amount for this specific case still needs a business decision before activation.
- Positive event points are awarded only after attendance is marked present.
- Profiles are public by default; a private option is retained for future privacy controls.
- Cafe is display-only: database-managed categories and menu items, with no cafe ordering.
- Loan extensions may be repeated. Each approved extension adds seven days; only one pending request per loan is allowed.
- One active/overdue loan per user; minimum loan fee 20,000 toman; initial loan period seven days.
- Daily overdue deductions are uniquely recorded per loan/date.
- Store and book purchases are requests; payment is in person.
- Event capacity counts people, not registration forms. Rule versions and accepted reward points are recorded at registration.
- Files are stored outside PostgreSQL; database stores metadata and storage keys.

## Run in pgAdmin
1. Connect to database herman.
2. Open Query Tool for herman.
3. Open this file: server/v2/schema.sql.
4. Paste and execute the complete SQL.
5. Refresh Schemas > public > Tables.
6. Run the verification query below.

The SQL creates tables/indexes and seeds user/admin roles and permission definitions. It does not create an administrator account or assign an admin phone. Use the protected server-side admin seed utility after configuring environment variables.

## Tables (37)
Accounts/security: users, profiles, roles, permissions, user_roles, role_permissions, user_permissions.
Points: points_ledger.
Store: store_categories, store_products, store_purchase_requests.
Cafe: cafe_categories, cafe_items.
Library: book_categories, books, book_purchase_requests, book_suggestions, loan_requests, loans, loan_extensions, loan_fines.
Events: events, event_rule_versions, event_registrations, event_attendees, event_attendance, event_penalties.
Forum/media: forum_topics, forum_comments, media_files, forum_topic_media, forum_comment_media.
System: notifications, app_settings, status_history, admin_audit_log.

## API and scheduled-job rules
1. Capacity: in one transaction lock the events row using SELECT FOR UPDATE, count attendee rows for registered registrations, and reject if proposed total exceeds capacity.
2. Award positive points only after attendance is confirmed. Use an idempotency key such as event-attendance:<registration_id>. Never award at registration.
3. event_penalties supports late_cancellation, after_start_cancellation and absence. Existing policy states -5 for cancellation one day before and -10 for absence. The amount for after-start cancellation is not specified; do not enable that deduction until its amount is confirmed. Insert penalty and ledger rows atomically.
4. At pickup create a loans row with due_at = picked_up_at + interval '7 days'. Each approved extension updates due_at by seven days and inserts a loan_extensions row. Repeat extensions are permitted with admin approval.
5. Apply 10 points per late day after the initial two-week period. Use one loan_fines row per loan/date and a matching idempotent negative points_ledger entry. More than one month after actual pickup with unresolved return/fine status triggers suspension; the API must make suspended accounts read-only. Restore access and remove the profile warning marker only after return and fine settlement.
6. Only users with forum.topic.create may create topics. Resolve permissions server-side, never from client-supplied role values.
7. Audit sensitive admin actions in admin_audit_log.
8. Snapshot purchase prices when a request is submitted. Payment is in person.
9. Cafe is menu display only in this release.
10. Public profile APIs expose only approved fields; never expose phone numbers, password hashes, permission assignments or internal operational fields.

## Verification query
~~~sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;
~~~

Expected table count: 37.

## Scope
This SQL creates database structure only. Express authentication/authorization, admin CRUD APIs, file storage integration, attendance/penalty jobs, loan scheduling and frontend integration still need implementation and testing. Do not switch production traffic or build the final APK until those are complete.
