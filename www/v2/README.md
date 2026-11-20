# Simorgh v2 — Frontend prototype

This is the first independent UI implementation for the rebuilt Simorgh app.

## Open locally
Open `index.html` in a modern browser, or serve the repository's `www` directory with any static web server and visit `/v2/`.

## Included in this prototype
- Home dashboard and navigation
- Cafe menu with category filters
- Separate loan and sale book views
- Loan requests with the 20,000 Toman minimum proposal rule
- Book suggestions
- Weekly notice and scheduled event presentation
- Event registration prototype
- Simorgh store with categories
- Forum topics and comments
- Member profile, membership level, points and notifications
- Admin demo mode for cafe, store, books, events and request review
- Local demo persistence in browser localStorage

## Important limitations
- This is a UI/interaction prototype. It does not authenticate real users and does not call an API.
- Demo records are stored only in the current browser. Clearing browser storage removes them.
- The role switch is only for previewing the admin UI. It is not an authorization mechanism.
- No real image upload, cloud storage, payments, cafe ordering or push notifications are implemented here.
- Do not enter real personal information into this prototype.

## Next implementation stages
1. Refine each screen against the product specification and mobile layouts.
2. Split the single-page prototype into maintainable components/modules.
3. Add the remaining detailed workflows: group event attendees, capacity by attendee count, cancellation rules, attendance, nested forum replies, image selection and admin permissions.
4. Add accessibility, input validation, automated UI tests and Android WebView checks.
5. Connect the finished UI to the API only after the user asks to resume backend/database work.
