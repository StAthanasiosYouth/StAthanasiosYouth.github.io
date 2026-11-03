/* =========================================================
   PHASE 7: APPS SCRIPT RETIRED (docs/PHASE7-PLAN.md)

   The site and the admin panel run on the Cloudflare Worker. This file
   went live with the retirement version (@62), together with one line at
   the top of doPost (Api.gs), doGet (Code.gs), bookNewsTick (BookNotify.gs),
   pushScheduleTick and pushScheduleDaily (CompSchedule.gs):

     if (APPS_SCRIPT_RETIRED_) return retiredOutput_();            // doPost, doGet
     if (APPS_SCRIPT_RETIRED_) return retireTriggers_(<handler>);  // the triggers

   Those lines are in the deployed version only (the live code plus the
   changed files, never this folder pushed as it is). Not in
   tools/build-worker-gs.mjs FILES: the Worker never loads it.

   Way back (while the 90-day window is open): redeploy the API deployment
   with -V 61, then re-arm the triggers from the editor (enableBookingAlerts,
   enableAutoPush) and delete the Worker's D1 setting APPS_SCRIPT.
========================================================= */

var APPS_SCRIPT_RETIRED_ = true;

/* every web request: one fixed answer, nothing read or written */
function retiredOutput_() {

  return ContentService
    .createTextOutput(JSON.stringify({ ok: false, code: 'retired', error: 'Apps Script is retired. The site and the admin run on the Worker.' }))
    .setMimeType(ContentService.MimeType.JSON);

}

/* a trigger's run after the retirement: removes every trigger of the project, then stops */
function retireTriggers_(handler) {

  var removed = 0;

  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    ScriptApp.deleteTrigger(trigger);
    removed++;
  });

  console.log('retired: ' + handler + ' removed ' + removed + ' trigger(s)');
  return removed;

}
