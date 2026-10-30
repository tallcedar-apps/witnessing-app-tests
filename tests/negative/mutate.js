// Makes one deliberately broken copy of the app for the breakage checks (ci/negative-checks.sh).
// Usage: node tests/negative/mutate.js <app-dir> <out-dir> <case>
// It copies <app-dir> to <out-dir> and applies one small change. If the text it needs to change
// isn't there (the app changed), it exits 2 so the breakage check reports "could not build"
// instead of quietly testing an unbroken copy.
'use strict';
const fs = require('fs');
const path = require('path');

const [, , appDir, outDir, name] = process.argv;
if (!appDir || !outDir || !name) {
  console.error('Usage: node tests/negative/mutate.js <app-dir> <out-dir> <case>');
  process.exit(64);
}

// Each case: file to change, exact text (string, changed once) or RegExp, and the replacement.
const CASES = {
  // No change to the app; the run uses a wrong EXPECTED_VERSION or OLD_REF instead.
  'wrong-version': [],
  'old-not-downloadable': [],
  'add-imports-nothing': [
    ['index.html', 'merge(r.sections, label)', 'merge([], label)'],
  ],
  'count-checksum-check-removed': [
    ['index.html', /^[ \t]*if \(obj\.sectionCount !== c\.s[^\n]*return "mismatch";[ \t]*\n/m, ''],
  ],
  'any-file-can-replace': [
    ['index.html', 'function backupCheck(obj){', 'function backupCheck(obj){ return "full";'],
  ],
  'one-safety-copy': [
    ['index.html', 'SAFETY_MAX = 3', 'SAFETY_MAX = 1'],
  ],
  'no-offline': [
    ['sw.js', 'addEventListener("fetch"', 'addEventListener("xfetch"'],
  ],
  'replace-skips-safety-copy': [
    ['index.html', 'return keepSafetyCopy(kind, drop).then(', 'return Promise.resolve(null).then('],
  ],
  // The tour must never change the notes: finishing it adds a section. The tour starts in 0.12, so older
  // versions report this case as "not applicable" (exit 3) instead of "could not build".
  'tour-finish-adds-section': [
    ['index.html', 'function setTour(how){ meta.tour = { state:"done", how:how, at:now() }; saveMeta(); }',
      'function setTour(how){ meta.tour = { state:"done", how:how, at:now() }; saveMeta(); if (how === "finished"){ ' +
      'data.sections.push({ id:"tourx"+Date.now(), title:"Tour extra", created:now(), topics:[] }); saveSoon(0); } }'],
  ],
  // Version 0.12.1 tour (the tour opens by itself once; no card). Older versions report these as "not applicable".
  // Escape ends the tour as "finished" instead of "skipped" (the app's own negative check J3).
  'tour-escape-finished': [
    ['index.html', 'if (e.key === "Escape"){ e.preventDefault(); close("skipped"); }', 'if (e.key === "Escape"){ e.preventDefault(); close("finished"); }'],
  ],
  // The tour never opens by itself for a brand-new copy.
  'tour-no-auto-open': [
    ['index.html', 'startTour(false, tourResumeKey());', '/* NEGATIVE CHECK: no auto tour */'],
  ],
  // Skip shows the old 0.12 wording instead of the 0.12.1 one.
  'tour-old-later-message': [
    ['index.html', 'var TOUR_LATER = "You can take the tour any time: tap ? Help, then Take the tour.";',
      'var TOUR_LATER = "OK. You can take the tour any time: tap Take the tour next to the version number.";'],
  ],
  // Help has no Take the tour button.
  'tour-help-button-missing': [
    ['index.html', `h += '<button type="button" class="plain tourhelp" id="tourHelp" data-act="tour">🧭 Take the tour</button>';`, ''],
  ],
  // The answer (finished/skipped) is not saved, so the app no longer remembers how the tour ended.
  'tour-answer-not-saved': [
    ['index.html', 'function setTour(how){ meta.tour = { state:"done", how:how, at:now() }; saveMeta(); }', 'function setTour(how){ meta.tour = { state:"done", how:how, at:now() }; }'],
  ],
  // People who update (they already have notes) get the tour opening by itself (all three of the app's guards removed).
  'tour-opens-for-updaters': [
    ['index.html', '{ state:"offer" } : { state:"done", how:"upgrade", at:now() }', '{ state:"offer" } : { state:"offer" }'],
    ['index.html', 'if (hasOwnNotes()){ setTour("ignored"); return false; }', ''],
    ['index.html', 'meta.tour && meta.tour.state === "offer") setTour("upgrade");', 'false) setTour("upgrade");'],
  ],
  // Android emulator only (ci/android-checks.sh): the app itself crashes the page. 1.5 s after the version under
  // test opens, it allocates memory without end until Chrome kills the page ("Aw, Snap! Out of memory"). In step 1
  // that happens right after "tap to update". Proves an app-caused crash FAILS and is never retried.
  // Not in ALL_CASES of ci/negative-checks.sh.
  'crash-page': [
    ['index.html', 'var APP_VERSION = "',
      '(function(){ /* NEGATIVE CHECK ONLY: crash the page */ var junk = []; setTimeout(function(){ for (;;) junk.push(new Array(1e6).fill(Math.random())); }, 1500); })();\nvar APP_VERSION = "'],
  ],
  'csp-removed-outside-image': [
    // Only the page's own CSP tag (the first one), not the one inside the print template.
    ['index.html', /<meta http-equiv="Content-Security-Policy" content="[^"]*">/,
      '<img src="https://example.com/favicon.ico" alt="" hidden><meta name="x-removed-csp" content="removed">'],
  ],
};

const edits = CASES[name];
const FROM = { 'tour-finish-adds-section': '0.12', 'tour-escape-finished': '0.12.1', 'tour-no-auto-open': '0.12.1', 'tour-old-later-message': '0.12.1',
  'tour-help-button-missing': '0.12.1', 'tour-answer-not-saved': '0.12.1', 'tour-opens-for-updaters': '0.12.1' };
if (!edits) {
  console.error('Unknown case: ' + name + '. Known: ' + Object.keys(CASES).join(', '));
  process.exit(64);
}

if (FROM[name]) {
  const m = /APP_VERSION = "(\d+(?:\.\d+)+)/.exec(fs.readFileSync(path.join(appDir, 'index.html'), 'utf8'));
  const a = m ? m[1].split('.').map(Number) : null, b = FROM[name].split('.').map(Number);
  let older = false;
  if (a) for (let i = 0; i < Math.max(a.length, b.length); i++) { const x = a[i] || 0, y = b[i] || 0; if (x !== y) { older = x < y; break; } }
  if (older) {
    console.log(name + ': not applicable (needs version ' + FROM[name] + ' or newer; this app is ' + m[1] + ')');
    process.exit(3);
  }
}
fs.rmSync(outDir, { recursive: true, force: true });
fs.cpSync(appDir, outDir, { recursive: true, filter: (src) => path.basename(src) !== '.git' });

for (const [file, find, repl] of edits) {
  const p = path.join(outDir, file);
  const before = fs.readFileSync(p, 'utf8');
  const found = typeof find === 'string' ? before.includes(find) : find.test(before);
  if (!found) {
    console.error(name + ': text to change was not found in ' + file + ' (' + String(find).slice(0, 60) + ')');
    process.exit(2);
  }
  const after = before.replace(find, repl);
  if (after === before) {
    console.error(name + ': change made no difference in ' + file);
    process.exit(2);
  }
  fs.writeFileSync(p, after);
}
console.log(name + ': built in ' + outDir);
