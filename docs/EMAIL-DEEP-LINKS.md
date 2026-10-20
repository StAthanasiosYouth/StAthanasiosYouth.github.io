# Email links: open the exact record (rule)

Owner decision, 2026-10-21: **every email button opens the page or action that the email is about**, not the home page. Example: when a booking is confirmed, the member taps «عرض تفاصيل الحجز» and sees that confirmed booking directly.

This applies to every email the service sends: the admin emails that exist today, and the member emails of Phase 5A/5B ([MEMBER-NOTIFICATIONS-PLAN](MEMBER-NOTIFICATIONS-PLAN.md)). The design is Azure Crest (`worker/src/notify/templates.js`); this page only defines where the button goes.

## 1. Targets

Member emails (site, signed-in member; never `/admin/`):

| Email | Button opens | Link (hash route, opaque ID only) |
| --- | --- | --- |
| Code (verify / recovery) | nothing: code only, no button | — |
| Security notice | the account's security section | `#me/security` |
| Booking: received / confirmed / rejected / cancelled / reopened | that booking | `#me/bookings/<ref>` |
| Booking money: payment recorded / voided / due changed / fully paid / reminder | that booking's payments | `#me/bookings/<ref>/payments` |
| Event changed («بلّغ الحاجزين») | that booking, with the change shown | `#me/bookings/<ref>` |
| Competition result (+ correction) | that participant's own result | `#me/results/<competition-slug>` |
| Points credited / deducted | the member's wallet | `#me/points` |
| Store order: requested / approved / cancelled + refund | that order | `#me/orders/<order-id>` |
| Notification settings (footer, Tier 2–3) | the member's notification settings | `#me/notifications` |

Admin emails (panel, `/admin/`; the route permission decides what opens):

| Email | Button opens | Link |
| --- | --- | --- |
| New booking(s), cash booking | the event's booking queue, filtered to the new ones | `#open/bookings/<event-id>` |
| Booking status change | that booking | `#open/booking/<booking-id>` |
| Payment recorded / voided / refund | that booking's payments | `#open/booking/<booking-id>/payments` |
| Accounts and permissions | that admin account in «الصلاحيات» | `#open/account/<admin-id>` |
| Content, settings, system | the changed item, else the activity entry | `#open/<kind>/<id>`, `#activity/<id>` |
| Daily summary | the activity log | `#activity` |

The route names above are the target shape; the exact names are fixed when each page is built.

## 2. Safety

- **Opaque IDs only.** The link carries a record ID or public reference (`B-7QK2M`, `ord-…`), never an email, phone, name, token, session or status secret, and no `#b/<token>` booking-status links.
- **The hash, not the query.** IDs live after `#`, so they are not sent in HTTP requests or written to server logs or referrer headers.
- **The server decides.** Opening a link loads nothing by itself. The page asks the server, which checks the session and the scope: a member sees only their own records, and an admin only what their grants allow (`ROUTE_PERMS`). An unknown ID and someone else's record get the same neutral answer («مش لاقيين ده»), so a link never reveals whether a record exists.
- **Service site only.** Buttons point to `https://stathanasiosyouth.github.io/` and member emails never contain `/admin/` (the `layout()` guards). No shorteners, no tracking parameters.
- **The same link in the plain-text part**, shown as text under the button too.

## 3. Sign-in and return to the destination

- No valid session: the page shows the sign-in (or registration) form in place, and keeps the destination.
- The destination is kept only for the current tab (`sessionStorage`). It is accepted only if it is an internal hash route on the allow-list above. Any other value (an absolute URL, `//…`, `javascript:`) is dropped, so there are no open redirects.
- After sign-in or registration, the app opens the destination once and then clears it. If it has expired (older than 30 min), the app opens the section page instead.
- Same behaviour as the competitions return-after-sign-in (YOUTH-ACCOUNTS-PLAN).
- The record is gone (deleted or merged): the section page opens with a short notice. The record changed since the email: the page shows its current state. The email is a notice, the page is the truth.

## 4. Status (2026-10-21)

- **Admin emails (active templates, router and email switches off):** buttons open the activity entry (`#activity/<id>`). The panel already supports `#open/<kind>/<id>` and `#open/bookings/<event-id>`. A follow-up, before the router is switched on, points booking, payment and account alerts at their exact records (§1).
- **Member emails (Phase 5A/5B, not wired):** every template takes the exact link from its caller. `bookingEmail` refuses `#b/` status-token links. The member pages and the return-to-destination flow are built with the member accounts (5A-4 bookings, 5B results, points, store).

## 5. Tests (with each phase)

- Every email kind has its exact target. No email links to the bare home page when a record exists.
- A link opens the record for its owner. Another member, or a signed-out user who then signs in as someone else, gets the neutral «مش لاقيين».
- Signed out → sign in → the same record opens. A destination outside the allow-list is ignored.
- No PII or token in any email URL. Member emails never contain `/admin/`.
