'use strict';
// Read-only smoke check of the LIVE site (https://tallcedar-apps.github.io/witnessing-app/).
// It only opens the page in brand-new, empty browser profiles; it never types notes, backs up, or changes anything.
// Checks, in Chromium (Android size) and WebKit (iPhone size; WebKit, not real Safari):
//   the page loads, it says "Version <EXPECTED_VERSION>", the offline helper takes control, it reopens offline,
//   its Content-Security-Policy is exactly the expected one, and no request goes to any site except the live site's own.
// Env: LIVE_URL (default the live site), EXPECTED_VERSION (required), OUT, CHROME_PATH (optional),
//      LIVE_TRIES / LIVE_WAIT_S: retries while GitHub Pages catches up after a push (default 6 tries, 30 s apart),
//      APP_DIR: the app's main branch checked out (the live index.html and sw.js must match its files byte for byte).
const pw = require('playwright'); const path = require('path'); const fs = require('fs'); const os = require('os');
const H = require('./lib/helpers'); const { dismissTourIfShown } = require('./lib/tour');

const URL_ = process.env.LIVE_URL || H.FALLBACK_URL;
const V = H.shortVer(process.env.EXPECTED_VERSION || '');
const OUT = process.env.OUT || path.join('results', 'live-smoke');
// Only the live site's own host may be contacted (tallcedar-apps.github.io for the real site).
const ALLOWED = [H.hostOf(URL_)];
const TRIES = +(process.env.LIVE_TRIES || 6), WAIT = +(process.env.LIVE_WAIT_S || 30);
if (/:8765\b/.test(URL_)) { console.error('Port 8765 is not allowed.'); process.exit(2); }
if (!V) { console.error('EXPECTED_VERSION is required'); process.exit(2); }

async function one(rec, engine){
  const WK = engine === 'webkit', S = WK ? 'live, WebKit' : 'live, Chromium';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-live-'));
  const opts = { ...(WK ? pw.devices['iPhone 15'] : pw.devices['Pixel 7']), headless: true, serviceWorkers: 'allow' };
  if (!WK && process.env.CHROME_PATH) opts.executablePath = process.env.CHROME_PATH;
  const ctx = await (WK ? pw.webkit : pw.chromium).launchPersistentContext(dir, opts);
  const outside = []; await H.watchRequests(ctx, outside, ALLOWED);
  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    page.on('dialog', H.dialogLogger(rec));
    const errors = []; H.attachErrorLog(page, errors, engine, ALLOWED);
    let shown = '', loaded = false;
    for (let i = 1; i <= TRIES; i++){
      const r = await page.goto(URL_ + '?cb=' + Date.now(), { waitUntil: 'load', timeout: 30000 }).catch(e => { shown = e.message; return null; });
      if (r && r.ok()){ loaded = true; await H.appReady(page).catch(() => {}); await dismissTourIfShown(page, rec);
        shown = (await page.textContent('#ver').catch(() => '')) || ''; if (shown.trim() === 'Version ' + V) break; }
      if (i < TRIES){ rec.note(S + ': try ' + i + ' saw "' + shown.trim() + '"; waiting ' + WAIT + ' s for GitHub Pages to catch up'); await page.waitForTimeout(WAIT * 1000); }
    }
    rec.check(S, 'the live page loads', loaded, shown);
    rec.check(S, 'the live page says "Version ' + V + '"', shown.trim() === 'Version ' + V, shown);
    rec.check(S, 'the list of sections shows', await page.locator('#app .row').count() > 0);
    const sw = await H.swReady(page);
    const keys = await page.evaluate(() => caches.keys());
    rec.check(S, 'the offline helper is in control with the cache witnessing-app-v' + V, sw && keys.includes('witnessing-app-v' + V), JSON.stringify(keys));
    await rec.shot(page, engine + '-live');
    const csp = await H.readCsp(page).catch(() => null);
    rec.check(S, 'the Content-Security-Policy is present and exactly as expected', csp === H.EXPECTED_CSP, csp === null ? 'no CSP meta tag' : csp);
    await ctx.setOffline(true);
    const off = !(await H.reachesServer(page, URL_));
    await page.reload({ timeout: 20000 }).catch(() => {}); await H.appReady(page).catch(() => {});
    const offVer = (await page.textContent('#ver').catch(() => '')) || '';
    rec.check(S, 'with no connection, the page reopens and still says "Version ' + V + '"', off && offVer.trim() === 'Version ' + V && await page.locator('#app .row').count() > 0, 'offline=' + off + ' shows "' + offVer.trim() + '"');
    await rec.shot(page, engine + '-live-offline');
    await ctx.setOffline(false);
    rec.check(S, 'no page errors', errors.length === 0, errors.join(' | '));
    rec.check(S, 'no requests to any site except ' + ALLOWED.join(', '), outside.length === 0, [...new Set(outside)].slice(0, 5).join(' '));
  } catch (e) { rec.check(S, 'smoke check finished without a crash', false, e.message.split('\n')[0]); }
  finally { await ctx.close().catch(() => {}); fs.rmSync(dir, { recursive: true, force: true }); }
}

// The live index.html and sw.js must be exactly the files on the app's main branch (sha256 of the bytes), not just
// say the right version. Fetched with a cache-busting query; retried like the version check while Pages catches up.
async function sameFiles(rec){
  const S = 'live files', dir = process.env.APP_DIR;
  if (!dir) { rec.skip(S, 'the live index.html and sw.js match the app\'s main branch (sha256)', 'APP_DIR is not set'); return; }
  const crypto = require('crypto'), sha = b => crypto.createHash('sha256').update(b).digest('hex');
  const want = {}; for (const f of ['index.html', 'sw.js']) want[f] = sha(fs.readFileSync(path.join(dir, f)));
  let got = {};
  for (let i = 1; i <= TRIES; i++){
    got = {};
    for (const f of ['index.html', 'sw.js']){
      try { const r = await fetch(URL_ + f + '?cb=' + Date.now(), { cache: 'no-store' }); got[f] = r.ok ? sha(Buffer.from(await r.arrayBuffer())) : 'HTTP ' + r.status; }
      catch (e) { got[f] = 'error ' + e.message; }
    }
    if (got['index.html'] === want['index.html'] && got['sw.js'] === want['sw.js']) break;
    if (i < TRIES){ rec.note(S + ': try ' + i + ' did not match yet; waiting ' + WAIT + ' s for GitHub Pages to catch up'); await new Promise(r => setTimeout(r, WAIT * 1000)); }
  }
  for (const f of ['index.html', 'sw.js'])
    rec.check(S, 'the live ' + f + ' is exactly the one on the app\'s main branch (sha256 ' + want[f].slice(0, 12) + '…)', got[f] === want[f], 'live ' + got[f] + ' / main ' + want[f]);
}

(async () => {
  const rec = H.makeRecorder('Live site smoke check (read-only) — ' + URL_ + ' — expecting ' + V, OUT);
  await sameFiles(rec);
  for (const e of (process.env.ENGINES || 'chromium,webkit').split(',')) await one(rec, e.trim());
  process.exit(rec.finish());
})();
