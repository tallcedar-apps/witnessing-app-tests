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
  rec.note('Device: ' + device.model() + ' (serial ' + device.serial() + ')');
  try { rec.note('Chrome: ' + (await device.shell('dumpsys package ' + CHROME + ' | grep -m1 versionName')).toString().trim()); } catch (e) { /* informational only */ }
  let ctx = null, devShots = 0, logcats = 0, closingCtx = false;
  // Diagnostics only: a copy of the emulator's full system log (made-up test data only) at the moment something went wrong.
  const saveLogcat = name => { try { fs.mkdirSync(path.join(OUT, 'device'), { recursive: true });
    fs.writeFileSync(path.join(OUT, 'device', 'logcat-' + String(++logcats).padStart(2, '0') + '-' + name + '.txt'), execFileSync('adb', ['logcat', '-d', '-b', 'main,system,crash,events', '-v', 'time'], { encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024 })); }
    catch (e) { console.log('logcat copy failed: ' + e.message); } };
  const devShot = async name => { try { fs.mkdirSync(path.join(OUT, 'device'), { recursive: true }); await device.screenshot({ path: path.join(OUT, 'device', String(++devShots).padStart(2, '0') + '-' + name + '.png') }); } catch (e) { console.log('device screenshot failed: ' + e.message); } };
  const env = {
    base: URL_, expectedVersion: V, picker: true, engineLabel: 'Android Chrome',
    oldRef: process.env.OLD_REF || '', oldError, oldFiles: old && old.files, oldVersion: old && old.version,
    outside: [], allowedHosts: H.LOCAL_HOSTS,
    async fresh({ picker } = {}){
      if (ctx) { closingCtx = true; await ctx.close().catch(() => {}); closingCtx = false; ctx = null; }
      // A fresh, empty Chrome profile: wipes only the emulator's Chrome data (made-up test data only).
      await device.shell('pm clear ' + CHROME);
      // Emulator setup only: allow Chrome's notifications up front so Chrome's own "Chrome notifications make
      // things easier" sheet doesn't cover the page and swallow the Back key. (The app never uses notifications.)
      await device.shell('pm grant ' + CHROME + ' android.permission.POST_NOTIFICATIONS').catch(() => {});
      ctx = await device.launchBrowser({ pkg: CHROME });
      await H.watchRequests(ctx, env.outside, env.allowedHosts);   // any request to another site fails the run
      await ctx.addInitScript(H.TOAST_LOG); await ctx.addInitScript(H.SHARE_MOCK); await ctx.addInitScript(H.PRINT_STUB);
      await ctx.addInitScript(picker ? H.PICKER_MOCK : H.NO_PICKER);
      const page = ctx.pages()[0] || await ctx.newPage();
      page.on('dialog', H.dialogLogger(rec));
      // Diagnostics only: say when Chrome closes or crashes the test's page, or opens another tab, with a device screenshot.
      let finished = false; const t0 = Date.now();
      page.on('crash', () => { rec.note('Chrome reported the page CRASHED after ' + (Date.now() - t0) + ' ms'); devShot('page-crashed'); });
      page.on('close', () => { if (!finished && !closingCtx) { rec.note('the test page CLOSED unexpectedly after ' + (Date.now() - t0) + ' ms'); devShot('page-closed'); saveLogcat('page-closed'); } });
      ctx.on('page', p => rec.note('Chrome opened another tab: ' + p.url()));
      const mine = ctx;
      return { page, ctx, done: async () => { finished = true; await devShot('profile-end'); await mine.close().catch(() => {}); if (ctx === mine) ctx = null; } };
    },
    android: true, retryClosedPage: true,
    onPageClosedRetry: async () => { await devShot('before-retry'); saveLogcat('before-retry'); },
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
