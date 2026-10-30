'use strict';
// Self-test for the fresh-start check used on Android (H.resetOrigin + H.freshState + H.cleanStart), in Chromium.
// 1) Open the app so it saves data (offline helper, offline copy, IndexedDB/OPFS, local storage), and add a cookie,
//    session storage, a file and a second tab. The check MUST report the site as NOT fresh and name what is left.
// 2) Clear the site from inside the browser. The check MUST then report it fresh.
// 3) cleanStart with a "clear" that does nothing MUST use the fallback with a WARNING, and MUST FAIL (throw) if the
//    fallback doesn't help either. So a fresh-start check can never pass on old data.
// Env: APP_URL (default http://localhost:8931/witnessing-app/), OUT
const pw = require('playwright'); const path = require('path'); const fs = require('fs'); const os = require('os');
const H = require('./lib/helpers');
const URL_ = process.env.APP_URL || 'http://localhost:8931/witnessing-app/';
const OUT = process.env.OUT || path.join('results', 'fresh-selftest');
if (/:8765\b/.test(URL_)) { console.error('Port 8765 is not allowed.'); process.exit(2); }
(async () => {
  const rec = H.makeRecorder('Fresh-start check self-test (Chromium) — ' + URL_, OUT);
  const dirs = []; const mk = async () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-fresh-')); dirs.push(d);
    const o = { ...pw.devices['Pixel 7'], headless: true, serviceWorkers: 'allow' }; if (process.env.CHROME_PATH) o.executablePath = process.env.CHROME_PATH;
    return pw.chromium.launchPersistentContext(d, o); };
  let ctx = await mk();
  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto(URL_ + '?cb=' + Date.now()); await H.appReady(page); await H.swReady(page);
    await page.evaluate(async () => { localStorage.__ciSelf = '1'; sessionStorage.__ciSelf = '1'; document.cookie = 'ciself=1; path=/';
      const r = await navigator.storage.getDirectory(); await r.getFileHandle('ci-selftest.txt', { create: true });
      await new Promise((res, rej) => { const q = indexedDB.open('ci-selftest'); q.onsuccess = () => { q.result.close(); res(); }; q.onerror = () => rej(q.error); }); });
    const tab2 = await ctx.newPage(); await tab2.goto(URL_ + '?cb=2');
    const probe = await ctx.newPage(); const before = await H.freshState(ctx, probe, URL_);
    const b = before.state;
    rec.check('self-test', 'with the app\'s data present, the check says NOT fresh', !before.fresh, before.left);
    rec.check('self-test', '... and names the service worker, offline copy, IndexedDB, local storage, file, cookie and other tabs',
      b.serviceWorkers.length > 0 && b.caches.length > 0 && b.indexedDB.includes('ci-selftest') && b.localStorage.includes('__ciSelf') && b.files.includes('ci-selftest.txt') && b.cookies.includes('ciself') && b.otherTabs.length >= 2, before.left);
    // session storage is per tab: check it in the tab that wrote it
    const ss = await H.freshState(ctx, page, URL_).catch(e => ({ state: { sessionStorage: ['error ' + e.message] } }));
    rec.check('self-test', '... and session storage left in a tab is reported', ss.state.sessionStorage.includes('__ciSelf'), JSON.stringify(ss.state.sessionStorage));
    const r = await H.resetOrigin(ctx, URL_); const after = await H.freshState(ctx, r.page, URL_);
    rec.check('self-test', 'after clearing the site from inside the browser (no new profile), the check says fresh', after.fresh, after.left);
    rec.check('self-test', '... and the service worker was unregistered first', r.unregistered >= 1, 'unregistered=' + r.unregistered);
    rec.check('self-test', '... a marker (local storage, IndexedDB, offline copy) was planted just before the clear, and it is gone after', H.markerOk(r) && after.state.marker.length === 0, JSON.stringify(r.planted) + ' left: ' + JSON.stringify(after.state.marker));
    rec.check('self-test', '... storage use is about 0, not persistent, no permissions granted, no controlling service worker', !after.state.storageUse.length && !after.state.persisted.length && !after.state.permissions.length && !after.state.swController.length, JSON.stringify({ usage: after.state.usageBytes, p: after.state.persisted, perm: after.state.permissions, ctl: after.state.swController }));
    // cleanStart with a reset that can't work: put data back, and make the fallback also leave data -> warn, then FAIL (throws).
    const fakeRec = H.makeRecorder('inner', path.join(OUT, 'inner'));
    // Simulate a clear that silently does nothing: every time the site's blank page loads, old data is put back first.
    const ctx2 = ctx; let fellBack = false, threw = false;
    await ctx2.addInitScript(() => { if (location.pathname === '/__ci/blank') localStorage.__ciStale = '1'; });
    const log = console.log; console.log = () => {};   // the inner check's own WARN/FAIL lines are expected here; keep them out of the log
    try { await H.cleanStart(ctx2, URL_, fakeRec, 1, async () => { fellBack = true; return ctx2; }); } catch (e) { threw = true; } finally { console.log = log; }
    rec.check('self-test', 'if the site can\'t be confirmed empty, the full-wipe fallback is used with a WARNING', fellBack && fakeRec.warnings === 1, 'fellBack=' + fellBack + ' warnings=' + fakeRec.warnings);
    rec.check('self-test', '... and if it is still not empty, the fresh-start check FAILS and the checks for that start do not run', threw && fakeRec.failed === 1, 'threw=' + threw + ' failed=' + fakeRec.failed);
    // A normal cleanStart on a new browser passes with no warning.
    await ctx.close(); ctx = await mk();
    const okRec = H.makeRecorder('inner2', path.join(OUT, 'inner2'));
    const p0 = ctx.pages()[0] || await ctx.newPage(); await p0.goto(URL_); await H.appReady(p0); await H.swReady(p0);
    const res = await H.cleanStart(ctx, URL_, okRec, 1, async () => { throw new Error('fallback should not be needed'); });
    rec.check('self-test', 'a normal fresh start after using the app: cleared and proven empty, no warning, page on about:blank', okRec.failed === 0 && okRec.warnings === 0 && res.page.url() === 'about:blank' && ctx.pages().length === 1, 'failed=' + okRec.failed + ' warnings=' + okRec.warnings + ' url=' + res.page.url());
  } catch (e) { rec.check('self-test', 'self-test finished without a crash', false, e.stack); }
  await ctx.close().catch(() => {});
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  process.exit(rec.finish());
})();
