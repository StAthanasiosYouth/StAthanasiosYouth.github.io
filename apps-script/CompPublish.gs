/**
 * COMPETITIONS IN THE ONE PUBLISH («راجع وانشر»). docs/COMPETITIONS.md §4.
 *
 * buildPublicContent (Content.gs) gets draft.competitions (CompStore.gs
 * compDraft_, through the cache) and calls compBuildPublic_ (CompModel.gs):
 * content.json gains `competitions: [{ id, slug, title, shortTitle, startAt,
 * endAt, v }]` (only when there is one: older content stays byte-identical),
 * a linked card gains `competition: <slug>`, the media competitions use join
 * the publish's media list, and problems are publish ERRORS. Because `v` is
 * the definition's hash, any change to a competition's public files changes
 * the content revision.
 *
 * apiPublish (Publish.gs) then:
 *   1. compWriteSnapshots_  — new definitions into Snapshots (content-addressed)
 *   2. compPublishFiles_    — competition/<slug>/index.html + comp.json (or the
 *                             withdrawn comp.json), in the SAME commit as content.json
 *   3. compAfterCommit_     — only after the commit landed: liveVersion /
 *                             publishedAt (withdrawn: liveVersion cleared), caches dropped
 * The steps are idempotent: an "unchanged" publish runs 1 and 3 again.
 */


/* comp.json's publishedAt: the stored one while the version is the same, else this publish */
function compPublishedAt_(entry, nowWall) {

  if (entry.comp.liveVersion === entry.version && entry.comp.publishedAt) {
    return contentDateTime_(entry.comp.publishedAt, false) || nowWall;
  }

  return nowWall;

}


/*
 * The engine shell as committed (competition/index.html), for the stubs:
 * cached 10 minutes; '' when it isn't there or GitHub doesn't answer (the
 * built-in copy is used then). Only a text that looks like the shell counts.
 */
function compShellText_() {

  var cache = CacheService.getScriptCache();
  var cached = cache.get('comp:shell');

  if (cached) return cached;

  try {
    var file = github_('get', '/contents/competition/index.html?ref=' + encodeURIComponent(githubConfig_().branch));
    var text = Utilities.newBlob(Utilities.base64Decode(String(file.content).replace(/\s/g, ''))).getDataAsString('UTF-8');
    if (!compShellOk_(text)) return '';
    try {
      cache.put('comp:shell', text, 600);
    }
    catch (ignored) {
      // too big for the cache: read again next time
    }
    return text;
  }
  catch (error) {
    return '';
  }

}


/**
 * { path: text } for the commit. comps: built.competitions; siteUrl: for
 * absolute OG URLs; shell: the committed engine shell ('' = the built-in copy).
 */
function compPublishFiles_(comps, siteUrl, nowWall, shell) {

  var files = {};

  if (!comps) return files;

  Object.keys(comps.live).forEach(function (id) {
    var entry = comps.live[id];
    var base = 'competition/' + entry.slug + '/';
    files[base + 'index.html'] = compStubHtml_(entry.def, siteUrl, entry.version, shell);
    files[base + 'comp.json'] = JSON.stringify(compPublicDef_(entry.def, entry.version, compPublishedAt_(entry, nowWall)), null, 2) + '\n';
  });

  // links people have keep working: the stub stays, comp.json says it's gone
  comps.withdrawn.forEach(function (gone) {
    files['competition/' + gone.slug + '/comp.json'] = JSON.stringify(compWithdrawnDef_(gone.slug), null, 2) + '\n';
  });

  return files;

}


/* step 1: the definitions this publish makes live, written once (one read, one block) */
function compWriteSnapshots_(comps, email, stamp) {

  if (!comps || !Object.keys(comps.live).length) return 0;

  var t = compSheet_('Snapshots');
  var have = Object.create(null);

  compColumns_(t, ['compId', 'version']).forEach(function (row) { have[row.compId + ':' + row.version] = true; });

  var records = [];

  Object.keys(comps.live).forEach(function (id) {
    var entry = comps.live[id];
    if (have[id + ':' + entry.version]) return;
    var text = JSON.stringify(entry.def);
    for (var i = 0; i * COMP_SNAPSHOT_PART < text.length; i++) {
      records.push({ compId: id, version: entry.version, part: String(i), json: text.slice(i * COMP_SNAPSHOT_PART, (i + 1) * COMP_SNAPSHOT_PART), publishedAt: stamp, publishedBy: email });
    }
  });

  compAppend_(t, records);

  return records.length;

}


/* step 3: after the commit — what is live now */
function compAfterCommit_(comps, stamp) {

  if (!comps) return;

  // pictures may have just gone to the site (explanation pictures follow it)
  compDropMediaOut_();

  var live = comps.live;
  var gone = Object.create(null);

  comps.withdrawn.forEach(function (w) { gone[w.id] = w; });

  if (!Object.keys(live).length && !comps.withdrawn.length) return;

  var t = compSheet_('Competitions');
  var changed = false;

  compRows_(t).forEach(function (row) {

    var entry = live[row.id];

    if (entry && (row.liveVersion !== entry.version || !row.publishedAt)) {
      compUpdate_(t, row.__row, { liveVersion: entry.version, publishedAt: row.liveVersion === entry.version && row.publishedAt ? row.publishedAt : stamp }, row);
      changed = true;
    }
    else if (gone[row.id] && row.liveVersion) {
      compUpdate_(t, row.__row, { liveVersion: '' }, row);
      changed = true;
    }

    if (entry || gone[row.id]) compDropLive_(row.slug);

  });

  if (changed) compDropDraft_();

}


/* the review's extra words: { compId: question count } */
function compReviewInfo_(comps) {

  var info = {};

  if (!comps) return info;

  Object.keys(comps.live).forEach(function (id) { info[id] = comps.live[id].questionCount; });

  return info;

}
