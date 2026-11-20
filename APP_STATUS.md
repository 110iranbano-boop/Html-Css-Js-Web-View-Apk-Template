# Simorgh app rebuild — status

Branch: `rebuild/simorgh-v2-from-scratch`

## Current scope
Per the current instruction, work is focused on the application code and user experience. Database provisioning, database reset, Chabakan deployment and production server connection are paused.

## Frontend prototype
- `www/v2/index.html`: standalone responsive Persian RTL prototype.
- `www/v2/README.md`: local run instructions and prototype limitations.
- `scripts/check-v2.js`: syntax check for inline JavaScript.
- `.github/workflows/v2-check.yml`: automated syntax check.

## Not yet complete
This is not the final production application. The prototype uses local browser demo data. Real authentication, authorization, durable data, server-side validation, uploads, and synchronized multi-device state require backend integration later. Detailed event rules, loan extension and overdue flows, admin permission matrix, and complete nested forum behavior remain to be implemented and tested.

## Safety of existing versions
The existing `main` branch and previous pull request are not modified or merged by this work.
