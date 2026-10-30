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
      let md = '### ' + label + '\n\n' + (rec.failed ? '❌ ' : '✅ ') + pass + ' passed, ' + rec.failed + ' failed, ' + skip + ' skipped\n\n';
      md += '| Result | Checklist step | Check | Details |\n|---|---|---|---|\n';
      for (const r of results) md += '| ' + (r.status === 'PASS' ? '✅ PASS' : r.status === 'FAIL' ? '❌ FAIL' : '⏭️ SKIP') + ' | ' + esc(r.step) + ' | ' + esc(r.name) + ' | ' + esc(r.status === 'PASS' ? '' : r.detail) + ' |\n';
      if (notes.length) md += '\nNotes:\n' + notes.map(n => '- ' + n).join('\n') + '\n';
      md += '\n';
      fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ label, results, notes }, null, 1));
      fs.writeFileSync(path.join(outDir, 'summary.md'), md);
      if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
      console.log('Total: ' + pass + ' passed, ' + rec.failed + ' failed, ' + skip + ' skipped');
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
module.exports = { TOAST_LOG, clearToasts, toastLog, toastSeen, serveOld, FALLBACK_URL, shortVer, vge, makeRecorder, mtext, modalOpen, mclose, closeResult, choices, choice, waitToast, toastNow, st, btn, hash, appVersion,
  SHARE_MOCK, PICKER_MOCK, NO_PICKER, PRINT_STUB, sharedFiles, captureShared, readSpotFile, listSpotFiles, restoreFile, saveFixture, appReady, swReady, reachesServer, attachErrorLog,
  LOCAL_HOSTS, hostOf, watchRequests, EXPECTED_CSP, readCsp, dialogLogger };
