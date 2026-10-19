/* =========================================================
   INSTAPAY / WALLET DESTINATIONS
   (docs/BOOKING-PHASE1-COMPLETION-PLAN.md §4.7, decision 12)
   ---------------------------------------------------------
   Each servant may have their own InstaPay number and wallet number
   (Servants: instapayNumber / walletNumber, PRIVATE) and a beneficiary
   name (payName). Empty → their phone is the fallback. The WhatsApp /
   contact phone and its visibility (publicWa) stay exactly as they are and
   do NOT decide this: only the PRIMARY admin's approval does.

   - Resolved destination = own number if set, else the phone; it must be a
     valid Egyptian mobile.
   - The primary admin approves THAT number («اعتمد رقم الدفع ده»): the
     approved number itself is stored (instapayApproved = '01xxxxxxxxx' +
     At / By). A destination is shown only while the resolved number equals
     the approved one — so ANY change (the own number, or the phone while it
     is the fallback) needs a new approval, with nothing to forget to clear.
   - The approved set goes to the Worker (signed, the whole set):
     POST /v1/sync/pay-dest (worker/src/book/pay.js). Never in event.json.
     Sent after every change, outside the script lock; a failed send marks
     PAY_DEST_DIRTY and the 5-minute booking tick (BookNotify.gs) sends again.
========================================================= */

var PAY_DEST_METHODS = {
  instapay: { field: 'instapayNumber', approved: 'instapayApproved', at: 'instapayApprovedAt', by: 'instapayApprovedBy', label: 'إنستاباي' },
  wallet: { field: 'walletNumber', approved: 'walletApproved', at: 'walletApprovedAt', by: 'walletApprovedBy', label: 'المحفظة' }
};
var PAY_DEST_DIRTY = 'PAY_DEST_DIRTY';

/* '+201…' / '01…' / Arabic digits → '01xxxxxxxxx', or '' */
function payLocal_(value) {

  var e164 = compNormPhoneEg_(value);

  return e164 ? '0' + e164.slice(3) : '';

}

/* '01012345678' → '010•••••678' (audit rows, notifications) */
function payMask_(local) {

  return local ? local.slice(0, 3) + '•••••' + local.slice(-3) : '';

}

/*
 * One servant × method → { method, number, source: 'own'|'phone'|'', approved,
 * approvedAt, approvedBy, problem } (number '' when there is none).
 */
function payDestOf_(row, method) {

  var spec = PAY_DEST_METHODS[method];
  var own = contentLine_(row[spec.field]);
  var number = own ? payLocal_(own) : payLocal_(row.phone);
  var source = own ? 'own' : number ? 'phone' : '';
  var approvedNumber = contentLine_(row[spec.approved]);
  var approved = !!number && approvedNumber === number;
  var problem = '';

  if (own && !number) problem = 'رقم ' + spec.label + ' مش رقم موبايل مصري صحيح';
  else if (!number) problem = 'مفيش رقم صحيح (لا رقم ' + spec.label + ' ولا رقم موبايل)';
  else if (!approved) problem = approvedNumber ? 'الرقم اتغيّر بعد الاعتماد: محتاج اعتماد تاني' : 'لسه محتاج اعتماد الأدمن الرئيسي';

  return {
    method: method,
    number: number,
    source: source,
    approved: approved,
    approvedAt: approved ? Number(row[spec.at]) || 0 : 0,
    approvedBy: approved ? contentLine_(row[spec.by]) : '',
    problem: problem
  };

}

/* for the admin: every pay method of the servant */
function payDestsOut_(row) {

  return Object.keys(PAY_DEST_METHODS).map(function (method) { return payDestOf_(row, method); });

}

/* the approved, active set → the Worker's shape */
function payDestPayload_() {

  var draft = pagesDraft_() || { servants: [] };
  var dests = [];

  (draft.servants || []).forEach(function (row) {
    if (!contentBool_(row.active)) return;
    Object.keys(PAY_DEST_METHODS).forEach(function (method) {
      var d = payDestOf_(row, method);
      if (!d.approved) return;
      dests.push({
        servantId: row.id, method: method, number: d.number, name: contentLine_(row.payName).slice(0, 60),
        source: d.source, approvedAt: d.approvedAt || Date.now(), approvedBy: d.approvedBy || primaryAdmin_()
      });
    });
  });

  return { dests: dests };

}

/* sends the approved set (never throws; never inside the script lock) → true when the Worker took it */
function payDestSync_() {

  var props = PropertiesService.getScriptProperties();

  try {
    var secret = workerSyncSecret_();
    if (!secret) return false;
    var body = JSON.stringify(payDestPayload_());
    var ts = String(Date.now());
    var response = UrlFetchApp.fetch(WORKER_API_URL + '/v1/sync/pay-dest', {
      method: 'post',
      contentType: 'application/json; charset=utf-8',
      payload: Utilities.newBlob(body).getBytes(),
      headers: { 'x-sync-ts': ts, 'x-sync-signature': 'v1=' + hmacHex_(secret, ts + '.' + body) },
      muteHttpExceptions: true,
      followRedirects: false
    });
    if (response.getResponseCode() === 200) {
      props.deleteProperty(PAY_DEST_DIRTY);
      return true;
    }
    console.warn('pay dest: HTTP ' + response.getResponseCode());
  }
  catch (error) {
    console.warn('pay dest: not sent: ' + ((error && error.message) || error));
  }

  props.setProperty(PAY_DEST_DIRTY, '1');
  return false;

}

/* the 5-minute booking tick: a send that failed earlier goes again */
function payDestRetry_() {

  if (PropertiesService.getScriptProperties().getProperty(PAY_DEST_DIRTY) === '1') payDestSync_();

}

/* the primary admin only (decision 12) */
function assertPrimary_() {

  var email = assertAdmin_();

  if (email !== primaryAdmin_()) {
    throw appError_('اعتماد أرقام الدفع للأدمن الرئيسي بس.', 'اطلب منه يعتمد الرقم.');
  }

  return email;

}

/**
 * «اعتمد رقم الدفع ده» (primary admin): approves the number the editor showed
 * — `number` must still be the resolved one (someone may have changed it
 * meanwhile). on = false takes the approval back.
 */
function apiServantPayApprove(id, method, number, on) {

  var email = assertPrimary_();

  pagesValidId_(id, SERVANT_ID, 'معرّف الخادم');
  if (!PAY_DEST_METHODS[method]) throw appError_('طريقة الدفع دي مالهاش رقم.', '');

  var spec = PAY_DEST_METHODS[method];

  pagesWrite_('servant.pay', function () {
    var found = pagesFind_('Servants', id);
    if (!found) throw new Error('الخادم مش موجود');
    assertUnlocked_('servant:' + id);
    var d = payDestOf_(compStrip_(found.row), method);
    var record = { updatedAt: compNow_().stamp };
    if (on === false) {
      record[spec.approved] = '';
      record[spec.at] = '';
      record[spec.by] = '';
    }
    else {
      if (!d.number) fail_([d.problem || 'مفيش رقم صحيح']);
      if (payLocal_(number) !== d.number) fail_(['الرقم اتغيّر من شوية. افتح الخادم تاني وراجع الرقم قبل ما تعتمده.']);
      record[spec.approved] = d.number;
      record[spec.at] = String(Date.now());
      record[spec.by] = email;
    }
    compUpdate_(found.t, found.row.__row, record, found.row);
    // never the number in the log («servant»: never a phone in `changes`)
    activityNote_({ action: 'pay.approve', type: 'servant', id: id, title: found.row.name, changes: { method: spec.label, off: on === false } });
  });

  payDestSync_();

  return apiServants();

}
