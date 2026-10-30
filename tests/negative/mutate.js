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
  'csp-removed-outside-image': [
    // Only the page's own CSP tag (the first one), not the one inside the print template.
    ['index.html', /<meta http-equiv="Content-Security-Policy" content="[^"]*">/,
      '<img src="https://example.com/favicon.ico" alt="" hidden><meta name="x-removed-csp" content="removed">'],
  ],
};

const edits = CASES[name];
const FROM = { 'tour-finish-adds-section': '0.12' };
if (!edits) {
  console.error('Unknown case: ' + name + '. Known: ' + Object.keys(CASES).join(', '));
  process.exit(64);
}

if (FROM[name]) {
  const m = /APP_VERSION = "(\d+)\.(\d+)/.exec(fs.readFileSync(path.join(appDir, 'index.html'), 'utf8'));
  const [fa, fb] = FROM[name].split('.').map(Number);
  if (m && (+m[1] < fa || (+m[1] === fa && +m[2] < fb))) {
    console.log(name + ': not applicable (needs version ' + FROM[name] + ' or newer; this app is ' + m[1] + '.' + m[2] + ')');
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
