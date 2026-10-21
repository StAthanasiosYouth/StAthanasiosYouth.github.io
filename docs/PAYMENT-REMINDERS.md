# Payment reminders and installments (Phase 1 final)

## What exists now

- **«دفع كامل» / «دفع قسط»** (public payment step, installment events only). The visitor's choice and amount are stored on the booking as `pay_plan` / `pay_claim` (migration 0008).
  - It is a **claim**, never money: the admin still records the payment from the proof. The confirm dialog pre-fills the first payment with the claim.
  - The Worker checks the rule: `minPart ≤ amount < total`, and only when the event is in installments mode (`payClaim` in `worker/src/book/model.js`). The page uses the same rule (`assets/js/page/book-model.js`).
  - The visitor is told the service will contact them about the rest. No automatic message is promised.
- **Reminders** (Finance page → «تذكير اللي عليهم باقي»), for **confirmed** bookings with a balance > 0 only.
  - The admin's own WhatsApp opens with a short text: booking ref, event title and the event page link. There are no amounts and no payment numbers.
  - Opening the event page from the same phone shows the booking (device token) with paid and remaining amounts.
  - `POST /v1/admin/book/events/:id/reminders` logs every reminder in `reminders` (append-only) plus an `activity` row (`booking.remind`).
  - The Worker refuses a second reminder for the same booking within 20 h (`recent`).
  - `GET …/reminders` returns the history.

## Push to participants: Phase 6 (not built)

A booking ref (or the status token) is **not** a Push subscription. A safe design needs all of these:

1. An explicit opt-in on the visitor's device after booking: «فعّل التنبيهات لحجزك».
2. A Web Push subscription created by the browser, sent together with the booking **token** (proof of access, kept on that device).
3. A table `booking_push (booking_id, endpoint, keys, created_ms, revoked_ms)`, bound to that booking only. It is removed on withdraw/cancel and 12 months after the event (with the phone).
4. A message body with no amounts or payment numbers, only «فيه تحديث في حجزك B-XXXX». Tapping it opens the status page from the device token.
5. The same dedupe and log as WhatsApp reminders (`reminders.channel = 'push'`, which needs a CHECK change in a new migration).

Until then, the reliable fallback is the WhatsApp reminder above, plus the status page («حجوزاتي») on the visitor's phone.

## Email to the booker: Phase 5A-4 (planned 2026-10-20, not built)

Contract: `docs/MEMBER-NOTIFICATIONS-PLAN.md` §4.2, `docs/EVENTS.md` §7.4.

- Only for bookings **linked to a youth account** with a verified email. Unlike the WhatsApp text, the email **includes paid, remaining and the due date** (owner D2): it goes to the account's own verified address. Never payment numbers, proofs or the status token.
- **Payment recorded / voided** and **amount due changed** are emailed automatically after the admin action commits; «اتدفع بالكامل» is a variant of the payment email, not a separate one.
- **Deadline reminders** by email: a per-event switch (off by default), at `finalDueAt` − 3 days and on the day; confirmed + balance > 0 only; skipped while a payment request is open; never within 20 h of a WhatsApp reminder for the same booking (the same `reminders` log with `channel = 'email'`, which needs the CHECK change of a new migration, together with `push`).
- Channel policy (Phase 6): push for the short nudge, email for the record of money.
