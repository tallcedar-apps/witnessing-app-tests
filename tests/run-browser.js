'use strict';
// Runs the checklist in Playwright's own browsers at phone size:
//   ENGINE=webkit   -> WebKit at iPhone size. This is WebKit, NOT real Safari and NOT a real iPhone.
//   ENGINE=chromium -> Chromium at Android phone size, with the stand-in save-file picker.
// Env: APP_URL (default http://localhost:8931/witnessing-app/), EXPECTED_VERSION (required), OLD_REF, OUT
const pw = require('playwright'); const path = require('path'); const fs = require('fs'); const os = require('os');
const H = require('./lib/helpers'); const { runChecklist } = require('./lib/checklist'); const { fetchOld } = require('./lib/oldversion');

const ENGINE = process.env.ENGINE || 'webkit';
const URL_ = process.env.APP_URL || 'http://localhost:8931/witnessing-app/';
const V = H.shortVer(process.env.EXPECTED_VERSION || '');
const OUT = process.env.OUT || path.join('results', ENGINE);
if (/:8765\b/.test(URL_)) { console.error('Port 8765 is not allowed.'); process.exit(2); }
if (!V) { console.error('EXPECTED_VERSION is required'); process.exit(2); }

const WK = ENGINE === 'webkit';
const device = WK ? pw.devices['iPhone 15'] : pw.devices['Pixel 7'];
const label = WK ? 'WebKit at iPhone size (Playwright WebKit, not real Safari, not a real iPhone)' : 'Chromium at Android phone size (Playwright, stand-in file picker)';

(async () => {
  const rec = H.makeRecorder(label + ' — ' + URL_ + ' — expecting ' + V, OUT);
  // When OLD_REF is set, the older version MUST be fetched: if it can't be, step 1 fails (it never quietly skips).
  let old = null, oldError = '';
  if (process.env.OLD_REF){ try { old = await fetchOld(process.env.OLD_REF); } catch (e) { oldError = e.message; } }
  const profiles = [];
  const env = {
    base: URL_, expectedVersion: V, picker: !WK, engineLabel: WK ? 'WebKit' : 'Chromium',
    oldRef: process.env.OLD_REF || '', oldError, oldFiles: old && old.files, oldVersion: old && old.version,
    outside: [], allowedHosts: H.LOCAL_HOSTS,
    async fresh({ picker } = {}){
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-ci-')); profiles.push(dir);
      const opts = { ...device, headless: true, acceptDownloads: true, serviceWorkers: 'allow' };
      if (!WK && process.env.CHROME_PATH) opts.executablePath = process.env.CHROME_PATH;
      const ctx = await (WK ? pw.webkit : pw.chromium).launchPersistentContext(dir, opts);
      await H.watchRequests(ctx, env.outside, env.allowedHosts);   // any request to another site fails the run
      await ctx.addInitScript(H.TOAST_LOG); await ctx.addInitScript(H.SHARE_MOCK); await ctx.addInitScript(H.PRINT_STUB);
      await ctx.addInitScript(picker ? H.PICKER_MOCK : H.NO_PICKER);
      const page = ctx.pages()[0] || await ctx.newPage();
      page.on('dialog', H.dialogLogger(rec));
      return { page, ctx, done: () => ctx.close() };
    },
    back: page => page.evaluate(() => history.back()),
    async offline(page, on){ await page.context().setOffline(on); return 'Playwright offline mode'; }
  };
  try { await runChecklist(env, rec); } catch (e) { rec.check('all', 'test run finished without a crash', false, e.stack); }
  const code = rec.finish();
  for (const d of profiles) fs.rmSync(d, { recursive: true, force: true });
  process.exit(code);
})();
