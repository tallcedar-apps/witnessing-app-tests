'use strict';
// Runs the checklist in real Chrome inside the Android emulator (GitHub-hosted Linux runner with KVM).
// The emulator reaches the local test server through "adb reverse", so http://localhost:PORT/... on the
// emulator is the runner's local server (localhost counts as secure, so the offline helper works).
// Env: APP_URL (default http://localhost:8931/witnessing-app/), EXPECTED_VERSION (required), OLD_REF, OUT
const { _android } = require('playwright'); const path = require('path'); const fs = require('fs');
const { execFileSync } = require('child_process');
const H = require('./lib/helpers'); const { runChecklist } = require('./lib/checklist'); const { fetchOld } = require('./lib/oldversion');

const URL_ = process.env.APP_URL || 'http://localhost:8931/witnessing-app/';
const PORT = new URL(URL_).port || '80';
const V = H.shortVer(process.env.EXPECTED_VERSION || '');
const OUT = process.env.OUT || path.join('results', 'android');
if (PORT === '8765') { console.error('Port 8765 is not allowed.'); process.exit(2); }
if (!V) { console.error('EXPECTED_VERSION is required'); process.exit(2); }
const CHROME = 'com.android.chrome';
// ANDROID_FRESH=wipe: the old way for every fresh start (force-stop + "pm clear" Chrome), still proven empty the same
// way. Only for the one side-by-side comparison run; the default (clear) clears the site from inside Chrome.
const FORCE_WIPE = process.env.ANDROID_FRESH === 'wipe';
const adb = (...a) => execFileSync('adb', a, { encoding: 'utf8', timeout: 60000 }).trim();
const reverseOn = () => adb('reverse', 'tcp:' + PORT, 'tcp:' + PORT);
const reverseOff = () => { try { adb('reverse', '--remove', 'tcp:' + PORT); } catch (e) { /* already removed */ } };

(async () => {
  const rec = H.makeRecorder('Chrome in the Android emulator (real Chrome; stand-in file picker and share sheet) — ' + URL_ + ' — expecting ' + V, OUT);
  // When OLD_REF is set, the older version MUST be fetched: if it can't be, step 1 fails (it never quietly skips).
  let old = null, oldError = '';
  if (process.env.OLD_REF){ try { old = await fetchOld(process.env.OLD_REF); } catch (e) { oldError = e.message; } }
  const [device] = await _android.devices();
  if (!device) { rec.check('setup', 'an Android emulator is connected', false, 'adb lists no device'); process.exit(rec.finish()); }
  rec.note('Fresh-start method: ' + (FORCE_WIPE ? 'full Chrome wipe (force-stop + pm clear) every time — side-by-side run (ANDROID_FRESH=wipe)' : 'clear the test site from inside Chrome (pm clear only as a fallback)'));
  rec.note('Device: ' + device.model() + ' (serial ' + device.serial() + ')');
  try { rec.note('Chrome: ' + (await device.shell('dumpsys package ' + CHROME + ' | grep -m1 versionName')).toString().trim()); } catch (e) { /* informational only */ }
  let ctx = null, devShots = 0, logcats = 0, closingCtx = false, freshN = 0;
  const withLimit = (p, ms, what) => { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(what + ' took longer than ' + (ms / 1000) + ' s')), ms); })]).finally(() => clearTimeout(t)); };
  // Test setup only: wait for Google Play services to finish restarting (see ci/android-settle.sh).
  const settle = label => { try { const o = execFileSync('bash', ['ci/android-settle.sh', label], { encoding: 'utf8', timeout: 300000 }); process.stdout.write(o);
      const line = o.split('\n').find(l => l.startsWith('SETTLE WAIT')); if (line) rec.note(line); if (/::warning::/.test(o)) rec.note('settle wait gave up: ' + label); }
    catch (e) { rec.note('settle wait failed (' + label + '): ' + e.message.split('\n')[0]); } };
  let step1Epoch = 0;
  const deviceEpoch = async () => parseFloat((await device.shell('date +%s')).toString().trim()) || 0;
  // Did Android itself shut Chrome down (proven cause: a dying Play services process whose helper Chrome uses)
  // since step 1 began? Returns the matching system-log line, or '' if not. Renderer ("sandboxed_process") deaths
  // and anything else don't count, so an app-caused crash is never retried.
  const closedBySystem = () => { try {
      const log = execFileSync('adb', ['logcat', '-d', '-b', 'events', '-v', 'epoch'], { encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
      const hit = log.split('\n').find(l => /\bam_kill\s*:\s*\[\d+,\d+,com\.android\.chrome,-?\d+,depends on provider .* in dying proc /.test(l) && parseFloat(l.trim()) >= step1Epoch - 1);
      return hit ? hit.trim().replace(/\s+/g, ' ').slice(0, 300) : '';
    } catch (e) { console.log('system log read failed: ' + e.message); return ''; } };
  // Diagnostics only: a copy of the emulator's full system log (made-up test data only) at the moment something went wrong.
  const saveLogcat = name => { try { fs.mkdirSync(path.join(OUT, 'device'), { recursive: true });
    fs.writeFileSync(path.join(OUT, 'device', 'logcat-' + String(++logcats).padStart(2, '0') + '-' + name + '.txt'), execFileSync('adb', ['logcat', '-d', '-b', 'main,system,crash,events', '-v', 'time'], { encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024 })); }
    catch (e) { console.log('logcat copy failed: ' + e.message); } };
  const devShot = async name => { try { fs.mkdirSync(path.join(OUT, 'device'), { recursive: true }); await device.screenshot({ path: path.join(OUT, 'device', String(++devShots).padStart(2, '0') + '-' + name + '.png') }); } catch (e) { console.log('device screenshot failed: ' + e.message); } };
  let ctxDead = false, inReset = false, launches = 0;
  // Start Chrome and connect to it. (Playwright's launchBrowser itself runs "am force-stop" first; that only happens
  // here: before the first fresh start, when Chrome isn't running yet, or after Android has already shut Chrome down.)
  const launch = async label => {
    // Emulator setup only: allow Chrome's notifications up front so Chrome's own "Chrome notifications make
    // things easier" sheet doesn't cover the page and swallow the Back key. (The app never uses notifications.)
    await device.shell('pm grant ' + CHROME + ' android.permission.POST_NOTIFICATIONS').catch(() => {});
    const c = await withLimit(device.launchBrowser({ pkg: CHROME }), 120000, 'starting Chrome (' + label + ')');
    ctx = c; ctxDead = false; launches++;
    c.on('close', () => { if (ctx === c) ctxDead = true; });
    await H.watchRequests(c, env.outside, env.allowedHosts);   // any request to another site fails the run
    await c.addInitScript(H.TOAST_LOG); await c.addInitScript(H.SHARE_MOCK); await c.addInitScript(H.PRINT_STUB);
    c.on('page', p => { if (!inReset) rec.note('Chrome opened another tab: ' + p.url()); });
    rec.note('Chrome started (' + label + '; start ' + launches + ')');
  };
  // FALLBACK ONLY (counted warning in H.cleanStart): the old full wipe, i.e. force-stop Chrome, "pm clear" it, start it again.
  const wipeAndLaunch = async n => {
    if (ctx) { closingCtx = true; await ctx.close().catch(() => {}); closingCtx = false; ctx = null; }
    await device.shell('input keyevent 3').catch(() => {});
    for (let i = 0; i < 10; i++) { const w = String(await device.shell('dumpsys window | grep -m1 mCurrentFocus || true')); if (!/com\.android\.chrome/.test(w)) break; await new Promise(r => setTimeout(r, 500)); }
    await new Promise(r => setTimeout(r, 2000));
    await withLimit(device.shell('am force-stop ' + CHROME), 120000, 'stopping Chrome (fallback wipe, fresh start ' + n + ')');
    for (let i = 0; i < 30; i++) { const p = String(await device.shell('pidof ' + CHROME + ' || true')).trim(); if (!p) break; await new Promise(r => setTimeout(r, 500)); }
    await new Promise(r => setTimeout(r, 1000));
    await withLimit(device.shell('pm clear ' + CHROME), 120000, 'pm clear (fallback wipe, fresh start ' + n + ')');
    await launch('after the fallback wipe, fresh start ' + n);
  };
  const env = {
    base: URL_, expectedVersion: V, picker: true, engineLabel: 'Android Chrome',
    oldRef: process.env.OLD_REF || '', oldError, oldFiles: old && old.files, oldVersion: old && old.version,
    outside: [], allowedHosts: H.LOCAL_HOSTS,
    // A fresh start for each group of checks. Chrome is started ONCE and reused: before each group, every tab is
    // closed, the test site's service workers are unregistered, and ALL of the test site's saved data is deleted from
    // inside Chrome (see H.resetOrigin); then H.cleanStart PROVES the site has no saved data left and only one tab is
    // open (a recorded check). Chrome is no longer force-stopped / "pm clear"-ed between fresh starts, because in
    // runs 7, 9, 41015994588 and 41017896562 the emulator program itself vanished right as Chrome was force-stopped
    // for that wipe. The old wipe is kept only as a fallback if the site can't be confirmed empty (counted WARNING).
    // ANDROID_FRESH=wipe (one side-by-side run only): use the old full wipe for every fresh start, then the same proof.
    async fresh({ picker } = {}){
      const tf = Date.now(); freshN++;
      let how = 'Chrome reused';
      if (!FORCE_WIPE && (!ctx || ctxDead)){ await launch('fresh start ' + freshN); how = 'Chrome started'; }
      inReset = true;
      let page, cs;
      try { cs = await H.cleanStart(ctx, env.base, rec, freshN, async () => { await wipeAndLaunch(freshN); return ctx; }, { forceWipe: FORCE_WIPE }); ctx = cs.ctx; page = cs.page; }
      finally { inReset = false; }
      console.log('NOTE fresh start ' + freshN + ' ready in ' + ((Date.now() - tf) / 1000).toFixed(1) + ' s (' + how + '; ' + cs.how + ')');
      await page.addInitScript(picker ? H.PICKER_MOCK : H.NO_PICKER);
      page.on('dialog', H.dialogLogger(rec));
      // Diagnostics only: say when Chrome closes or crashes the test's page, with a device screenshot.
      let finished = false; const t0 = Date.now();
      page.on('crash', () => { rec.note('Chrome reported the page CRASHED after ' + (Date.now() - t0) + ' ms'); devShot('page-crashed'); });
      page.on('close', () => { if (!finished && !closingCtx && !inReset) { rec.note('the test page CLOSED unexpectedly after ' + (Date.now() - t0) + ' ms'); devShot('page-closed'); saveLogcat('page-closed'); } });
      return { page, ctx, done: async () => { finished = true; await devShot('profile-end'); await page.close().catch(() => {}); } };
    },
    android: true, retryClosedPage: true,
    stopAfterStep1: process.env.STOP_AFTER_STEP1 === '1',
    markStep1Start: async () => { step1Epoch = await deviceEpoch(); },
    closedBySystem,
    onPageClosedRetry: async () => { await devShot('before-retry'); saveLogcat('before-retry'); settle('before the step-1 retry'); },
    // The real Android Back key.
    back: async () => { await device.shell('input keyevent 4'); },
    async offline(page, on){
      if (on){
        reverseOff();
        let how = 'adb reverse removed';
        try { await device.shell('cmd connectivity airplane-mode enable'); how += ' + airplane mode on'; }
        catch (e) { await device.shell('svc wifi disable; svc data disable').catch(() => {}); how += ' + Wi-Fi and mobile data off'; }
        await page.waitForTimeout(1500); await devShot('offline');
        return how;
      }
      try { await device.shell('cmd connectivity airplane-mode disable'); } catch (e) { await device.shell('svc wifi enable; svc data enable').catch(() => {}); }
      reverseOn(); await page.waitForTimeout(1500);
      return 'adb reverse restored + airplane mode off';
    }
  };
  try { reverseOn(); await runChecklist(env, rec); }
  catch (e) { rec.check('all', 'test run finished without a crash', false, e.stack); }
  finally { await devShot('final'); closingCtx = true; if (ctx) await ctx.close().catch(() => {}); try { reverseOn(); } catch (e) { /* ignore */ } }
  const code = rec.finish();
  await device.close().catch(() => {});
  process.exit(code);
})();
