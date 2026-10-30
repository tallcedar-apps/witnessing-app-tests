// Shared helpers: results, summary, modal/toast helpers, and stand-ins for phone features.
// All test data is made up inside the tests ("Phone test", "Test topic", "CI fixture ..."). No real notes.
'use strict';
const fs = require('fs'), path = require('path');

const FALLBACK_URL = 'https://tallcedar-apps.github.io/witnessing-app/';

// "0.11 (proof of concept)" -> "0.11"
const shortVer = v => String(v || '').trim().split(/\s+/)[0];
// version compare: vge("0.12", "0.12") === true
const vge = (a, b) => { const x = shortVer(a).split('.').map(Number), y = shortVer(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++){ const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0; } return true; };

function makeRecorder(label, outDir){
  fs.mkdirSync(outDir, { recursive: true });
  const results = [], notes = [];
  let shotN = 0;
  const rec = {
    label, outDir, results, notes,
    check(step, name, ok, detail){
      const r = { step, name, status: ok ? 'PASS' : 'FAIL', detail: detail === undefined ? '' : String(detail).replace(/\s+/g, ' ').slice(0, 400) };
      results.push(r); console.log((ok ? 'PASS ' : 'FAIL ') + '[' + step + '] ' + name + (r.detail && !ok ? '  (' + r.detail + ')' : ''));
      return ok;
    },
    // A counted warning: something went wrong in the test setup and was handled (e.g. a retried step). Shown in
    // the headline and the table, and turned into a GitHub ::warning:: by the CI script. It never hides a FAIL.
    warn(step, name, detail){ const r = { step, name, status: 'WARN', detail: String(detail || '').replace(/\s+/g, ' ').slice(0, 600) };
      results.push(r); console.log('WARN [' + step + '] ' + name + (r.detail ? '  (' + r.detail + ')' : '')); },
    // Mark rows recorded since index i as belonging to a first try (e.g. " (try 1)"), so a retried step's rows are clear.
    tagRows(i, suffix){ for (let k = i; k < results.length; k++) if (results[k].status !== 'WARN') results[k].name += suffix; },
    get warnings(){ return results.filter(r => r.status === 'WARN').length; },
    skip(step, name, why){ results.push({ step, name, status: 'SKIP', detail: why }); console.log('SKIP [' + step + '] ' + name + '  (' + why + ')'); },
    note(t){ notes.push(t); console.log('NOTE ' + t); },
    async shot(page, name){
      try { await page.waitForTimeout(300); const f = path.join(outDir, 'screenshots', String(++shotN).padStart(2, '0') + '-' + name + '.png');
        fs.mkdirSync(path.dirname(f), { recursive: true }); await page.screenshot({ path: f }); } catch (e) { console.log('screenshot failed: ' + e.message); }
    },
    get failed(){ return results.filter(r => r.status === 'FAIL').length; },
    finish(){
      const pass = results.filter(r => r.status === 'PASS').length, skip = results.filter(r => r.status === 'SKIP').length;
      const esc = s => String(s).replace(/\|/g, '\\|');
      const warnN = rec.warnings, warnTxt = warnN ? ', ⚠️ ' + warnN + ' warning' + (warnN === 1 ? '' : 's') : '';
      let md = '### ' + label + '\n\n' + (rec.failed ? '❌ ' : '✅ ') + pass + ' passed, ' + rec.failed + ' failed, ' + skip + ' skipped' + warnTxt + '\n\n';
      md += '| Result | Checklist step | Check | Details |\n|---|---|---|---|\n';
      for (const r of results) md += '| ' + (r.status === 'PASS' ? '✅ PASS' : r.status === 'FAIL' ? '❌ FAIL' : r.status === 'WARN' ? '⚠️ WARNING' : '⏭️ SKIP') + ' | ' + esc(r.step) + ' | ' + esc(r.name) + ' | ' + esc(r.status === 'PASS' ? '' : r.detail) + ' |\n';
      if (notes.length) md += '\nNotes:\n' + notes.map(n => '- ' + n).join('\n') + '\n';
      md += '\n';
      fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ label, passed: pass, failed: rec.failed, skipped: skip, warnings: warnN, results, notes }, null, 1));
      fs.writeFileSync(path.join(outDir, 'summary.md'), md);
      if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
      console.log('Total: ' + pass + ' passed, ' + rec.failed + ' failed, ' + skip + ' skipped' + (warnN ? ', ' + warnN + ' warning' + (warnN === 1 ? '' : 's') : ''));
      return rec.failed ? 1 : 0;
    }
  };
  return rec;
}

// Modal, toast, and state helpers (same selectors as the app's own tests).
const mtext = async (page, timeout) => { await page.waitForSelector('#modal.show', { timeout: timeout || 10000 }); return (await page.textContent('#modal .sheet')).replace(/\s+/g, ' '); };
const modalOpen = async page => !!(await page.$('#modal.show'));
const mclose = async (page, sel) => { await page.locator(sel || '#modal .ok').first().click(); await page.waitForSelector('#modal.show', { state: 'hidden' }); await page.waitForTimeout(200); };
// Close a result message whatever its buttons are ("Close"/"OK" is .no when there is a second choice).
const closeResult = async page => { if (!(await modalOpen(page))) return; const no = page.locator('#modal .no'); await ((await no.count()) ? no.first() : page.locator('#modal .ok').first()).click(); await page.waitForSelector('#modal.show', { state: 'hidden' }); await page.waitForTimeout(200); };
const choices = page => page.$$eval('#modal .choices button', bs => bs.map(b => ({ t: b.textContent.replace(/\s+/g, ' '), c: b.className })));
const choice = (page, re) => page.locator('#modal .choices button', { hasText: re }).first().click();
const waitToast = (page, re, timeout) => page.waitForFunction(s => { const t = document.getElementById('toast'); return t && t.classList.contains('show') && new RegExp(s).test(t.textContent); }, re.source, { timeout: timeout || 6000 }).then(() => true, () => false);
const toastNow = page => page.evaluate(() => { const t = document.getElementById('toast'); return t ? t.textContent : ''; });
const st = page => page.evaluate(() => ({ data: JSON.stringify(window.__wa.data.sections), changed: window.__wa.changed(), safety: window.__wa.safety.length, spot: window.__wa.meta.saveSpot || null }));
const btn = (page, re) => page.locator('button', { hasText: re }).first();
const hash = page => page.evaluate(() => location.hash);
const appVersion = page => page.evaluate(() => (window.__wa && window.__wa.version) || (document.documentElement.outerHTML.match(/APP_VERSION = "([^"]+)"/) || [])[1] || '');

// Stand-in for the phone's share sheet: keeps the shared file's name and text so the test can use it
// as a restore file. Installed before the app loads, on every page load.
const SHARE_MOCK = () => {
  const keep = (name, text) => { try { const a = JSON.parse(sessionStorage.__ciShared || '[]'); a.push({ name, text }); sessionStorage.__ciShared = JSON.stringify(a); } catch (e) {} };
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
  Object.defineProperty(navigator, 'share', { configurable: true, value: async d => { const f = d && d.files && d.files[0]; keep(f ? f.name : '(no file)', f ? await f.text() : ''); } });
};
// Stand-in for the Android "save file" screen (from the app's own v11 tests): a real file handle in the
// browser's private storage. localStorage.__perm / __permAfter play the "Allow" prompt after a restart.
const PICKER_MOCK = () => {
  window.showSaveFilePicker = async opts => { localStorage.__picks = (+(localStorage.__picks || 0)) + 1;
    const root = await navigator.storage.getDirectory(); return root.getFileHandle(localStorage.__pickName || opts.suggestedName, { create: true }); };
  if (window.FileSystemHandle){
    FileSystemHandle.prototype.queryPermission = async function(){ return localStorage.__perm || 'granted'; };
    FileSystemHandle.prototype.requestPermission = async function(){ localStorage.__reqN = (+(localStorage.__reqN || 0)) + 1; const a = localStorage.__permAfter || 'granted'; if (a === 'granted') localStorage.__perm = 'granted'; return a; };
  }
};
const NO_PICKER = () => { try { window.showSaveFilePicker = undefined; } catch (e) {} };
// Stand-in for the print screen: counts the calls and sends the same before/after events a real print screen does.
const PRINT_STUB = () => { window.print = () => { sessionStorage.__ciPrinted = String((+(sessionStorage.__ciPrinted || 0)) + 1);
  window.dispatchEvent(new Event('beforeprint')); window.dispatchEvent(new Event('afterprint')); }; };

const sharedFiles = page => page.evaluate(() => JSON.parse(sessionStorage.__ciShared || '[]'));
// Run an action that should hand a file to the share sheet; returns {name, text} or null.
async function captureShared(page, action, timeout){
  const before = (await sharedFiles(page)).length;
  await action();
  const ok = await page.waitForFunction(n => JSON.parse(sessionStorage.__ciShared || '[]').length > n, before, { timeout: timeout || 8000 }).then(() => true, () => false);
  return ok ? (await sharedFiles(page))[before] : null;
}
const readSpotFile = (page, name) => page.evaluate(async n => { const root = await navigator.storage.getDirectory(); try { const h = await root.getFileHandle(n); return await (await h.getFile()).text(); } catch (e) { return null; } }, name);
async function listSpotFiles(page){ return page.evaluate(async () => { const out = []; const root = await navigator.storage.getDirectory(); for await (const [n] of root.entries()) out.push(n); return out; }); }

// Hand a restore file to the app's hidden file input (buffer payload works on the emulator too).
async function restoreFile(page, file){
  await page.setInputFiles('#pickRestore', { name: file.name, mimeType: 'application/json', buffer: Buffer.from(file.text) });
}
function saveFixture(rec, file){ const d = path.join(rec.outDir, 'fixtures'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, file.name), file.text); }

// Wait until the app has finished opening (rows, empty list, or another screen).
async function appReady(page){
  await page.waitForSelector('#app .row, #app .empty, #bkbtn-page, #restorePanel', { timeout: 20000 });
  await page.waitForFunction(() => window.__wa && window.__wa.spot && window.__wa.spot.ready, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(300);
}
// Wait for the offline helper (service worker) to be in control and its cache filled.
async function swReady(page){
  return page.evaluate(async () => { await navigator.serviceWorker.ready;
    for (let i = 0; i < 100; i++){ const k = await caches.keys(); if (k.length && (await (await caches.open(k[0])).keys()).length >= 4 && navigator.serviceWorker.controller) return true; await new Promise(r => setTimeout(r, 150)); }
    return !!navigator.serviceWorker.controller; });
}
// Does the page still reach the server? (Used to prove an offline check is really offline.)
const reachesServer = (page, base) => page.evaluate(async u => { try { const r = await fetch(u + 'ci-probe?t=' + Date.now() + Math.random(), { cache: 'no-store' }); return r.status === 204; } catch (e) { return false; } }, base);

// Errors that are expected and not a problem:
//  - "interactive-widget": a harmless viewport warning some browsers print;
//  - "Response served by service worker is an error": the offline probe failing on purpose while offline.
// Network errors ("Failed to load resource", net::ERR_...) are ignored ONLY when they are for an allowed host
// (the local test server, or the live site in the live check), e.g. during the planned offline steps.
// A network error for any other site is recorded and fails the "no page errors" check.
const LOCAL_HOSTS = ['localhost', '127.0.0.1'];
const hostOf = u => { try { return new URL(u).hostname; } catch (e) { return ''; } };
function attachErrorLog(page, list, tag, allowedHosts){
  const allowed = allowedHosts || LOCAL_HOSTS;
  const netErr = /Failed to load resource|ERR_INTERNET_DISCONNECTED|net::ERR/;
  page.on('pageerror', e => { if (/Response served by service worker is an error/.test(e.message)) return; list.push(tag + ' [pageerror] ' + e.message); });
  page.on('console', m => {
    if (m.type() !== 'error') return; const t = m.text();
    if (/interactive-widget|Response served by service worker is an error/.test(t)) return;
    if (netErr.test(t)){
      const loc = (m.location && m.location().url) || ''; const urls = (t.match(/https?:\/\/[^\s"')]+/g) || []).concat(loc ? [loc] : []);
      if (urls.length && urls.every(u => allowed.includes(hostOf(u)))) return;
      list.push(tag + ' [console, network] ' + t + (loc ? ' (' + loc + ')' : '')); return;
    }
    list.push(tag + ' [console] ' + t);
  });
}
// Records every request a browser context makes to a host that is not allowed (data: and blob: are fine).
// The app should never contact any site except the one it was loaded from.
async function watchRequests(ctx, list, allowedHosts){
  const allowed = allowedHosts || LOCAL_HOSTS;
  const add = u => {
    if (!u) return;
    const scheme = ((/^([a-z][a-z0-9+.-]*):/i.exec(u) || [])[1] || '').toLowerCase();
    if (!['http', 'https', 'ws', 'wss'].includes(scheme)) return;   // data:, blob:, about:, chrome:, chrome-error:, chrome-native:, … never leave the computer
    if (!allowed.includes(hostOf(u)) && !list.includes(u)) list.push(u);
  };
  ctx.on('request', r => add(r.url()));
  ctx.on('requestfailed', r => add(r.url()));
  // Backstop: Chromium doesn't report every request to Playwright (a hidden <img> to another site, for one, never
  // shows up as a request event). So each page also reports every resource it tried to load, from the browser's own
  // timing list, which includes failed and blocked loads.
  await ctx.exposeBinding('__ciResource', (src, u) => add(String(u))).catch(() => {});
  await ctx.addInitScript(() => {
    try {
      new PerformanceObserver(l => { for (const e of l.getEntries()) if (window.__ciResource) window.__ciResource(e.name); })
        .observe({ type: 'resource', buffered: true });
    } catch (e) { /* very old browser: the request events above still apply */ }
  });
}
// The app's Content-Security-Policy, exactly as versions 0.11 and 0.12 ship it. If the app changes its CSP on purpose,
// update this string in the same change, so a loosened CSP can never slip through unnoticed.
const EXPECTED_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: blob:; media-src data: blob:; connect-src 'self' data: blob:; manifest-src 'self'; worker-src 'self'; form-action 'none'; base-uri 'none'";
const readCsp = page => page.evaluate(() => { const m = document.querySelector('meta[http-equiv="Content-Security-Policy" i]'); return m ? m.getAttribute('content') : null; });
// Logs a native browser pop-up (alert/confirm/prompt) and dismisses it, so it is never hidden.
const dialogLogger = rec => d => { rec.note('Native ' + d.type() + ' pop-up dismissed: "' + d.message() + '"'); d.dismiss().catch(() => {}); };

// Tell the local test server to serve (files = {'index.html','sw.js'}) or stop serving (null) the older version.
async function serveOld(base, files){
  const root = new URL('/__ci/old/', base);
  if (!files) { const r = await fetch(root, { method: 'DELETE' }); if (!r.ok) throw new Error('test server would not stop the older files: ' + r.status); return; }
  for (const name of ['index.html', 'sw.js']) { const r = await fetch(new URL(name, root), { method: 'PUT', body: files[name] }); if (!r.ok) throw new Error('test server would not take ' + name + ': ' + r.status); }
}
// Init script: remembers every toast message shown (for messages that are quickly replaced by the next one).
const TOAST_LOG = `(() => { const hook = () => { const t = document.getElementById('toast'); if (!t) return;
  new MutationObserver(() => { try { const a = JSON.parse(sessionStorage.__ciToasts || '[]'); const x = t.textContent; if (x && a[a.length - 1] !== x) { a.push(x); sessionStorage.__ciToasts = JSON.stringify(a.slice(-50)); } } catch (e) {} })
    .observe(t, { childList: true, characterData: true, subtree: true }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook); else hook(); })();`;
const clearToasts = page => page.evaluate(() => { sessionStorage.__ciToasts = '[]'; });
const toastLog = page => page.evaluate(() => JSON.parse(sessionStorage.__ciToasts || '[]')).catch(() => []);
// True if a toast matching re is showing now, or was shown since the last clearToasts (waits up to timeout).
async function toastSeen(page, re, timeout){
  const end = Date.now() + (timeout || 6000);
  for (;;) { if ((await toastLog(page)).some(x => re.test(x)) || re.test(await toastNow(page).catch(() => ''))) return true;
    if (Date.now() > end) return false; await page.waitForTimeout(200); }
}
// ---------- Fresh start without a new browser profile (Android: Chrome is started once and reused) ----------
// 1. Open one new tab and close every other tab (so no page of the test site is open).
// 2. On the site's blank page (/__ci/blank, served by tests/serve.js, outside the app): plant a MARKER (an IndexedDB
//    database, a local-storage key and an offline copy, all named __ci_marker) and unregister the site's service workers.
// 3. Leave the site (about:blank), then delete ALL of the test site's saved data with Chrome's own command
//    (Storage.clearDataForOrigin, storage types "all": IndexedDB, local storage, service workers, offline copies
//    (Cache Storage), file storage, cookies, ...), plus Chrome's web (HTTP) cache (Network.clearBrowserCache).
// 4. Open a NEW tab, close the old one, and load the blank page there (freshState then checks it).
// Returns { page, unregistered, planted, clearMs }.
const CI_BLANK = '/__ci/blank';
async function resetOrigin(ctx, base){
  const origin = new URL(base).origin, blank = origin + CI_BLANK, t0 = Date.now();
  const keep = await ctx.newPage();
  for (const p of ctx.pages()) if (p !== keep) await p.close().catch(() => {});
  await keep.goto(blank);
  const planted = await keep.evaluate(async () => {
    const out = {};
    try { localStorage.__ci_marker = '1'; out.localStorage = localStorage.__ci_marker === '1'; } catch (e) { out.localStorage = false; }
    try { await new Promise((res, rej) => { const q = indexedDB.open('__ci_marker'); q.onupgradeneeded = () => q.result.createObjectStore('m');
        q.onsuccess = () => { const db = q.result; const tx = db.transaction('m', 'readwrite'); tx.objectStore('m').put(1, 'k'); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); };
        q.onerror = () => rej(q.error); });
      out.indexedDB = (await indexedDB.databases()).some(d => d.name === '__ci_marker'); } catch (e) { out.indexedDB = false; }
    try { const c = await caches.open('__ci_marker'); await c.put('/__ci/marker', new Response('marker')); out.caches = (await caches.keys()).includes('__ci_marker'); } catch (e) { out.caches = false; }
    return out;
  });
  const unregistered = await keep.evaluate(async () => { const rs = await navigator.serviceWorker.getRegistrations(); for (const r of rs) await r.unregister(); return rs.length; });
  await keep.goto('about:blank');
  const c0 = Date.now();
  const cdp = await ctx.newCDPSession(keep);
  try {
    await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
    await cdp.send('Network.clearBrowserCache');
  } finally { await cdp.detach().catch(() => {}); }
  const clearMs = Date.now() - c0;
  const page = await ctx.newPage();
  await keep.close().catch(() => {});
  await page.goto(blank);
  return { page, unregistered, planted, clearMs, totalMs: Date.now() - t0 };
}
// Most bytes the browser may still report as used by the test site after clearing (navigator.storage.estimate()).
// "About zero": an empty site reports 0 in Chromium; a little room is left for the browser's own bookkeeping.
const FRESH_USAGE_MAX = 64 * 1024;
// Reads everything the test site has saved, from the site's blank page. Fresh = every list empty and one tab open:
// no IndexedDB, local or session storage, cookies, file storage, offline copies (Cache Storage), service-worker
// registrations or controlling service worker; storage use about 0; storage not marked persistent; the
// persistent-storage and notifications permissions not granted; and no __ci_marker left.
async function freshState(ctx, page, base){
  const blank = new URL(base).origin + CI_BLANK;
  if (page.url() !== blank) await page.goto(blank);
  const s = await page.evaluate(async max => {
    const out = {}, err = e => ['(could not read: ' + (e && e.message || e) + ')'];
    try { out.indexedDB = (await indexedDB.databases()).map(d => d.name); } catch (e) { out.indexedDB = err(e); }
    try { out.serviceWorkers = (await navigator.serviceWorker.getRegistrations()).map(r => r.scope); } catch (e) { out.serviceWorkers = err(e); }
    try { out.swController = navigator.serviceWorker.controller ? [navigator.serviceWorker.controller.scriptURL] : []; } catch (e) { out.swController = err(e); }
    try { out.caches = await caches.keys(); } catch (e) { out.caches = err(e); }
    try { out.localStorage = Object.keys(localStorage); } catch (e) { out.localStorage = err(e); }
    try { out.sessionStorage = Object.keys(sessionStorage); } catch (e) { out.sessionStorage = err(e); }
    try { const r = await navigator.storage.getDirectory(); out.files = []; for await (const [n] of r.entries()) out.files.push(n); } catch (e) { out.files = err(e); }
    out.cookies = document.cookie ? document.cookie.split(';').map(c => c.trim().split('=')[0]) : [];
    try { const est = await navigator.storage.estimate(); out.usageBytes = est.usage; out.storageUse = est.usage > max ? [est.usage + ' bytes in use'] : []; } catch (e) { out.storageUse = err(e); }
    try { out.persisted = (await navigator.storage.persisted()) ? ['storage is marked persistent'] : []; } catch (e) { out.persisted = err(e); }
    out.permissions = [];
    for (const name of ['persistent-storage', 'notifications']){
      try { const q = await navigator.permissions.query({ name }); out['perm_' + name] = q.state; if (q.state === 'granted') out.permissions.push(name + ' granted'); }
      catch (e) { out.permissions.push(name + ' (could not read: ' + e.message + ')'); }
    }
    return out;
  }, FRESH_USAGE_MAX);
  s.otherTabs = ctx.pages().filter(p => p !== page).map(p => p.url());
  s.marker = [].concat(s.indexedDB, s.localStorage, s.caches).filter(n => /__ci_marker/.test(n));
  const left = Object.entries(s).filter(([, v]) => Array.isArray(v) && v.length).map(([k, v]) => k + ': ' + JSON.stringify(v));
  return { fresh: left.length === 0, left: left.join('; '), state: s };
}
const markerOk = r => !!(r && r.planted && r.planted.localStorage && r.planted.indexedDB && r.planted.caches);
// Before each fresh start when the browser is reused: clear the test site (up to 3 tries), then PROVE it is empty:
// the marker planted just before the clear must have been written and must be gone, and freshState must find nothing.
// If it still isn't, `fallback()` (Android: the old force-stop + "pm clear" + new Chrome) is used with a counted
// WARNING, and the site is checked again. The result is a recorded check; if the site is still not empty, this
// throws, so no fresh-start check can ever pass on old data. Returns { ctx, page } (page left on about:blank).
// opts.forceWipe: use the full wipe every time (for the side-by-side run; a note, not a warning).
async function cleanStart(ctx, base, rec, n, fallback, opts){
  opts = opts || {};
  const tries = []; let r, st, how = 'cleared from inside the browser';
  const attempt = async withMarker => {
    try { r = await resetOrigin(ctx, base); st = await freshState(ctx, r.page, base);
      if (withMarker && !markerOk(r)) st = { fresh: false, left: 'the marker could not be planted before clearing: ' + JSON.stringify(r.planted) + (st.left ? '; ' + st.left : ''), state: st.state };
    } catch (e) { st = { fresh: false, left: 'error: ' + e.message.split('\n')[0] }; }
  };
  if (opts.forceWipe){
    ctx = await fallback(); how = 'full browser wipe (chosen for the side-by-side run)';
    await attempt(true);
  } else {
    for (let i = 1; i <= 3; i++){
      await attempt(true);
      if (st.fresh) break;
      tries.push('try ' + i + ': ' + st.left); await new Promise(res => setTimeout(res, 1000));
    }
    if (!st.fresh){
      rec.warn('Fresh start', 'fresh start ' + n + ': clearing the test site from inside the browser did not leave it empty, so the full browser wipe was used instead', tries.join(' | '));
      ctx = await fallback(); how = 'full browser wipe (fallback)';
      await attempt(true);
    }
  }
  const S = st.state || {};
  rec.note('fresh start ' + n + ': ' + how + '; clear took ' + (r ? r.clearMs : '?') + ' ms (' + (r ? r.totalMs : '?') + ' ms with tab handling and the marker); storage in use after: ' + S.usageBytes + ' bytes; permissions: persistent-storage ' + S['perm_persistent-storage'] + ', notifications ' + S.perm_notifications);
  rec.check('Fresh start', 'fresh start ' + n + ': a marker planted just before clearing is gone, and the test site has no saved data left (IndexedDB, local and session storage, cookies, file storage, offline copies, service workers or a controlling one, storage use about 0, not persistent, no permissions granted) and only one tab is open', st.fresh, how + (st.left ? ' — ' + st.left : ''));
  if (!st.fresh) throw new Error('fresh start ' + n + ': the test site still has saved data: ' + st.left);
  await r.page.goto('about:blank');
  return { ctx, page: r.page, how };
}
// Init script for brand-new copies: records whether the "New version ready" note (#updnote) was ever shown
// (sessionStorage.__ciUpdnote = JSON list of { ms since the page started, text }).
const UPDNOTE_WATCH = `(() => { const hook = () => { const u = document.getElementById('updnote'); if (!u) return;
  const seen = () => { try { if (!u.hidden){ const a = JSON.parse(sessionStorage.__ciUpdnote || '[]'); a.push({ ms: Math.round(performance.now()), text: (u.textContent || '').trim().slice(0, 120) }); sessionStorage.__ciUpdnote = JSON.stringify(a.slice(-10)); } } catch (e) {} };
  seen(); new MutationObserver(seen).observe(u, { attributes: true, attributeFilter: ['hidden'] }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook); else hook(); })();`;
const updnoteSeen = page => page.evaluate(() => JSON.parse(sessionStorage.__ciUpdnote || '[]')).catch(e => [{ error: e.message }]);
// No share sheet at all (for the "saves to Downloads" check).
const NO_SHARE = () => { try { Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }); Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined }); } catch (e) {} };
module.exports = { TOAST_LOG, clearToasts, toastLog, toastSeen, serveOld, FALLBACK_URL, shortVer, vge, makeRecorder, mtext, modalOpen, mclose, closeResult, choices, choice, waitToast, toastNow, st, btn, hash, appVersion,
  SHARE_MOCK, PICKER_MOCK, NO_PICKER, PRINT_STUB, sharedFiles, captureShared, readSpotFile, listSpotFiles, restoreFile, saveFixture, appReady, swReady, reachesServer, attachErrorLog,
  LOCAL_HOSTS, hostOf, watchRequests, EXPECTED_CSP, readCsp, dialogLogger, resetOrigin, freshState, cleanStart, markerOk, UPDNOTE_WATCH, updnoteSeen, NO_SHARE, CI_BLANK };
