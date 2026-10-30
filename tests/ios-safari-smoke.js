'use strict';
// EXPERIMENTAL: drives real Mobile Safari in the iOS Simulator through Apple's safaridriver (WebDriver).
// Only runs on the macOS runner, after `sudo safaridriver --enable` and `safaridriver -p 4444 &`.
// The workflow marks this step continue-on-error: if safaridriver can't attach to the Simulator, the job still passes
// and the Summary says so. It only opens the app with fresh test data; no notes are typed.
// Env: APP_URL, EXPECTED_VERSION, SIM_UDID, WD_URL (default http://127.0.0.1:4444), OUT
const fs = require('fs'); const path = require('path'); const H = require('./lib/helpers');
const URL_ = process.env.APP_URL || 'http://localhost:8931/witnessing-app/';
const WD = process.env.WD_URL || 'http://127.0.0.1:4444';
const V = H.shortVer(process.env.EXPECTED_VERSION || '');
const OUT = process.env.OUT || path.join('results', 'ios-safari');
if (/:8765\b/.test(URL_ + WD)) { console.error('Port 8765 is not allowed.'); process.exit(2); }

async function wd(method, p, body){
  const r = await fetch(WD + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(method + ' ' + p + ': ' + r.status + ' ' + JSON.stringify(j.value || j).slice(0, 300));
  return j.value;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const rec = H.makeRecorder('Experimental, does not affect pass/fail: real Mobile Safari in the iOS Simulator via safaridriver — ' + URL_, OUT);
  let sid = null; const S = 'iOS Safari (Simulator)';
  const js = (script, args) => wd('POST', '/session/' + sid + '/execute/sync', { script, args: args || [] });
  const shot = async name => { try { const b64 = await wd('GET', '/session/' + sid + '/screenshot'); fs.mkdirSync(path.join(OUT, 'screenshots'), { recursive: true }); fs.writeFileSync(path.join(OUT, 'screenshots', name + '.png'), Buffer.from(b64, 'base64')); } catch (e) { rec.note('screenshot failed: ' + e.message); } };
  const waitFor = async (script, ms) => { const end = Date.now() + (ms || 15000); for (;;) { const v = await js(script).catch(() => null); if (v) return v; if (Date.now() > end) return null; await sleep(300); } };
  try {
    const caps = { platformName: 'iOS', browserName: 'Safari', 'safari:useSimulator': true };
    if (process.env.SIM_UDID) caps['safari:deviceUDID'] = process.env.SIM_UDID;
    const s = await wd('POST', '/session', { capabilities: { alwaysMatch: caps } }); sid = s.sessionId;
    rec.check(S, 'safaridriver started a Mobile Safari session in the Simulator', !!sid);
    await wd('POST', '/session/' + sid + '/url', { url: URL_ + '?cb=' + Date.now() });
    const ver = await waitFor("var e=document.getElementById('ver'); return e && document.querySelector('#app .row') ? e.textContent : null;", 20000);
    rec.check(S, 'the app opens in real Mobile Safari and says "Version ' + V + '"', !!ver && ver.trim() === 'Version ' + V, ver);
    await shot('01-safari-main');
    // A tour prompt (0.12+) may cover the screen on fresh data; close it if a skip-style button is showing.
    await js("var b=[].slice.call(document.querySelectorAll('button')).find(function(x){return x.offsetParent&&/^(no thanks|skip( the)? tour|skip|not now|maybe later)$/i.test(x.textContent.trim())}); if(b) b.click(); return !!b;");
    const opened = await js("var r=document.querySelector('#app .row button.open'); if(!r) return null; var t=r.textContent; r.click(); return t;");
    const inSection = await waitFor("return /^#\\/s\\//.test(location.hash) ? location.hash : null;", 8000);
    rec.check(S, 'tapping the first section opens it', !!opened && !!inSection, inSection || '');
    await shot('02-safari-section');
    await wd('POST', '/session/' + sid + '/url', { url: URL_ + '#/backup' });
    const bk = await waitFor("return document.getElementById('bkbtn-page') ? document.getElementById('app').textContent : null;", 10000);
    rec.check(S, 'the Back up screen opens', !!bk && /Back up/.test(bk));
    await shot('03-safari-backup');
  } catch (e) { rec.check(S, 'safaridriver run finished without a crash', false, e.message); }
  finally { if (sid) await wd('DELETE', '/session/' + sid).catch(() => {}); }
  process.exit(rec.finish());
})();
