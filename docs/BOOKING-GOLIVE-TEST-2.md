# Go-live test #2: Booking Phase 1

Plan: `docs/BOOKING-PHASE1-COMPLETION-PLAN.md` rev. 4, §6 step 10. Event: the temporary test event `booking-test-temp` (`evt-4011914c`).

**No real money in this test:**
- payments are recorded with the note «تجربة»;
- in InstaPay / the wallet app, paste the number, check that the app accepts it and shows the right name, then **cancel before sending**;
- screenshots are sample images.

`B-Z8PSQ` and all test records are kept. The cleanup happens only before the official launch, with a separate go.

## 0. Before you start
- [ ] Worker on production with migration 0005; `PAY_DEST` = `'0'`.
- [ ] Apps Script deployed as v43.
- [ ] Events republished, so `event.json` carries `methods[].online` (cash = `false`).
- [ ] Admin «الخدام» → طرق الدفع: cash has «الزوار يدفعوا بيها من الموقع» **off**, InstaPay and wallet **on**. Save if anything changed, then publish again.
- [ ] On your phone: the installed `/admin/` app → the bell → admin notifications **on** for this device. Opt-in is per device; this was the most likely reason push was missed.
- [ ] Optional, to read the first miss: Sheet «Activity», row `booking.new` of 17:03, column `notified`.

## 1. Booking push to the Primary Admin
1. Close the admin panel everywhere (or leave it open only on the PC, in a background tab).
2. From another phone or a private window, make a visitor booking with InstaPay or wallet (section 3) or with any online method.
3. Expected within ~5 minutes: a push «حجز جديد – …» on your phone. Tapping it opens «الحجوزات» for that event.
4. Admin «سجل النشاط» → the `booking.new` row says «الإشعار وصل لـ N جهاز». If it says «من غير إشعار: …», note the reason and report it.
5. Repeat with the panel **open and visible** on the PC: the PC shows the toast, and the phone still gets the push.

## 2. Booking screens (admin)
- [ ] In the installed app (signed in by device): «الحجوزات» is in the menu and on the event. It asks for Google once, then shows the queue.
- [ ] The home page shows the «الحجوزات» card with «مستنيين المراجعة».
- [ ] The queue header shows new / confirmed / rejected counts, free places, due / received / balance.
- [ ] A booking sheet shows the proof preview, «اتصال» / «واتساب», and «السجل».

## 3. InstaPay / wallet payment card (`PAY_DEST` still OFF)
- [ ] With the card off: picking InstaPay shows «كلّم الخادم على واتساب» (same flow as before).
- [ ] Admin «الخدام» → a servant → «أرقام الدفع»: enter your own InstaPay number (or leave it empty to use the phone) → save → «اعتمد رقم الدفع ده» → confirm. The chip becomes «إنستاباي معتمد».
- [ ] **Then tell me to turn the card on**: settings `PAY_DEST` = `'1'`, a one-line D1 change I make after your OK.
- [ ] On a phone, book with InstaPay and check:
  - the card shows the amount, the number `01x xxxx xxxx` and the name;
  - «نسخ الرقم» → «اتنسخ الرقم ✓»;
  - in the InstaPay app, paste: the number is accepted and the right name shows; **cancel**;
  - back in the browser, the page is on the same step and says «رجعت؟»;
  - «تم التحويل» → a screenshot is required → send → «قيد المراجعة».
- [ ] Admin: confirm it with a payment noted «تجربة».

## 4. Cash via servants
- [ ] Booking page: cash is **not** a choice. The «هتدفع كاش؟» card lists the servants. WhatsApp shows only for a servant with «رقمه يظهر للزوار», and its message names this event.
- [ ] Admin «حجز يدوي», cash, amount filled, **«أكّده دلوقتي» on** → confirmed at once, payment recorded.
- [ ] Admin «حجز يدوي», cash, amount filled, **off** → «جديد» with the payment counted. Then «تأكيد» → «المدفوع المتسجل لحد دلوقتي» → confirm without typing the money again.

## 5. Excel
- [ ] «الملخص والحسابات» → download the XLSX → RTL; «الموبايل» shows `010…` with the leading 0; names and notes stay plain text.

## Phase 1 fixes after the first real test (branch `book/phase1-fixes`)

**Confirmed bugs, fixed:**
- **Admin push was deferred** until the next heartbeat of some open panel. An admin who saved and swiped the app away, with nobody else in the panel, left the push waiting («pending:now») until someone opened Admin. This is the main cause of «sometimes it arrives, sometimes not». The 5-minute trigger now sends waiting pushes too (≤ 5 min), whether the panel is open or not.
- **Tapping a booking push** opened the admin home, because `admin/sw.js` didn't allow `#open/bookings/…`. Fixed.
- **App launch was two Apps Script round trips** (`deviceSignIn`, then `apiSessionStart`) behind «جاري استعادة الجلسة». It is now one: the session and panel state come back with the device token.
- **A swiped-away app** left its session "live" for ~90 s, so a quick reopen asked «take over the other device?». The same trusted device now takes its own session over silently. A different device still gets the question, and authentication is unchanged.
- **Cash box** was always shown. Cash is now a choice that shows only its box (servant, WhatsApp by consent, prefilled for the event) and never sends.
- **Pending badge:** a number on «الحجوزات» and on «الصفحات والفعاليات» in the rail and dock. It refreshes every 60 s while visible, on return to the app, and after every write.
- New on the payment card: «عايز تتأكد قبل التحويل؟ تواصل مع المسؤول» (WhatsApp, consent only).

**Not a bug: missing payment numbers.** `PAY_DEST` = `'0'` by design, so InstaPay/wallet still says «كلّم الخادم على واتساب». The card shows only after a number is approved AND `PAY_DEST` is turned on, with your OK.

**Known limitations (temporary Apps Script architecture; Phase 1.5 adds Gmail, Phase 6 moves push to the Worker, real-device audit at the end):**
- Push latency: up to ~5 minutes for booking alerts and for admin activity sent by the trigger. Faster (~30 s) while any admin panel is open.
- By design, some admin edits don't push:
  - repeated edits of the same item within the cooldown;
  - reorder / show-hide (log only);
  - the actor's own devices;
  - the device whose panel is on screen (it gets the in-panel toast).
- Each device must opt in once (the bell in the installed `/admin/` app). Clearing site data or revoking the notification permission silently ends that device until it opts in again.
- Android battery saver / iOS Focus can delay or hide notifications. FCM accepted the send: the log says «الإشعار وصل لـ N جهاز» (FCM accepted, not "seen").
- Every launch still waits for one Apps Script call (~2–4 s). Fully instant launch needs Phase 3 (sessions on the Worker).
- Bookings, approvals and accounting never depend on notifications: everything is in «الحجوزات» and «سجل النشاط».

## 6. After the test
- Leave the test event open (the site isn't launched).
- Send me what failed. I'll fix it on a branch, verify on staging and ask before deploying.
- Rollback if needed:
  - Worker: `npx wrangler rollback 5db72d2e-fc02-4e6f-ac04-ff2bb2b38b1f`;
  - Apps Script: redeploy the previous version;
  - the payment card: `PAY_DEST` = `'0'`.
