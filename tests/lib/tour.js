'use strict';
// First-time tour (added in version 0.12). These checks run only when the app is 0.12 or newer.
//
// The selectors and wording below match the 0.12 app: a card on the main screen (#tourCard, "New here? A short tour
// shows how the app works…" with "Start the tour" / "No thanks"), then tour screens in the app's message box
// (#modal .sheet.tour, "Step N of M", buttons "Skip tour", "‹ Back", "Next ›", and "Done" on the last one).
// The app remembers the answer in its own setting meta.tour (state "offer" or "done"), read via window.__wa.tour.
const TOUR = {
  // Text that identifies the card on the main screen.
  prompt: /New here\?.*short tour shows how the app works|^Step \d+ of \d+/is,
  // Buttons on the card.
  start: /^Start the tour$/,
  skip: /^(No thanks|Skip tour)$/,
  // Buttons inside the tour.
  next: /^Next ›$/,
  finish: /^Done$/,
  maxSteps: 15,
  // Where the tour lives: the card on the main screen, then the tour screens in the app's message box.
  containers: ['#tourCard:not([hidden])', '#modal .sheet.tour', '[role="dialog"]'],
  // The app's own tour setting: true once the tour is done (finished, skipped, declined), false while it is still
  // offered, null if the app has no tour setting.
  seenFlag: () => { const t = window.__wa && window.__wa.tour; return t ? t.state === 'done' : null; }
};
const TOUR_FROM = '0.12';
// What the tour must never change: the notes, the backup record, the safety copies, and the save spot.
const notesSnap = page => page.evaluate(() => JSON.stringify({ s: window.__wa.data.sections, b: window.__wa.meta.backup || null,
  safety: window.__wa.safety.map(c => c.id), spot: window.__wa.meta.saveSpot || null }));
async function sameAfterReload(page, before){ await page.waitForTimeout(600); await page.reload(); await page.waitForSelector('#app', { timeout: 20000 }); await page.waitForTimeout(800); const after = await notesSnap(page); return [after === before, after === before ? '' : 'before ' + before.slice(0, 200) + ' | after ' + after.slice(0, 200)]; }

// Visible box that contains the tour prompt or a tour step, or null. Never matches the backup reminder (#remind).
async function tourBox(page){
  for (const sel of TOUR.containers){
    const loc = page.locator(sel).filter({ hasText: TOUR.prompt });
    const n = await loc.count();
    for (let i = 0; i < n; i++){ const b = loc.nth(i); if (await b.isVisible().catch(() => false)) return b; }
  }
  // A tour step may not repeat the prompt text: look for a dialog with Next/Finish buttons.
  for (const sel of TOUR.containers){
    const loc = page.locator(sel).filter({ has: page.getByRole('button', { name: TOUR.next }) });
    if (await loc.count() && await loc.first().isVisible().catch(() => false)) return loc.first();
    const fin = page.locator(sel).filter({ has: page.getByRole('button', { name: TOUR.finish }) }).filter({ hasText: /tour|step \d/i });
    if (await fin.count() && await fin.first().isVisible().catch(() => false)) return fin.first();
  }
  return null;
}
const waitTourBox = async (page, ms) => { const end = Date.now() + (ms || 4000); while (Date.now() < end){ const b = await tourBox(page); if (b) return b; await page.waitForTimeout(250); } return null; };

// Used after every fresh load by the other checks: if a tour prompt shows, tap its skip button. Never fails.
async function dismissTourIfShown(page, rec){
  // 0.12.1+: while the app still plans to open the tour by itself (state "offer", not answered yet), wait longer for it
  // (a slow phone may take a few seconds), so it can't open later on top of another check.
  const offer = await page.evaluate(() => { const t = window.__wa && window.__wa.tour; return !!t && t.state === 'offer'; }).catch(() => false);
  const b = await waitTourBox(page, offer ? 15000 : 2500);
  if (!b) return false;
  const skip = b.getByRole('button', { name: TOUR.skip });
  if (await skip.count()){ await skip.first().click(); await page.waitForTimeout(400); if (rec) rec.note('A tour prompt appeared on fresh data and was dismissed with its skip button.'); return true; }
  if (rec) rec.note('A tour-like box appeared but no skip button matched; TOUR.skip may need updating.');
  return false;
}

// Full tour checks. env.fresh() gives a brand-new empty profile page; env.back(page) presses the phone's Back.
async function openFresh(env){ const r = await env.fresh({ picker: env.picker }); await r.page.goto(env.base + '?cb=' + Date.now()); await r.page.waitForSelector('#app', { timeout: 20000 }); return r; }
async function tourChecks(env, rec, version){
  const S = 'Tour (0.12+)';
  if (!require('./helpers').vge(version, TOUR_FROM)){ rec.skip(S, 'First-visit tour checks', 'app is version ' + version + '; the tour starts in ' + TOUR_FROM); return; }
  // 0.12.1 and newer: the tour opens by itself (no card); see tour121Checks below.
  if (require('./helpers').vge(version, TOUR121_FROM)) return tour121Checks(env, rec, version);
  // 1. Appears on a fresh first run; Skip sets the seen flag; it doesn't come back after a reload.
  let { page, done } = await openFresh(env);
  let b = await waitTourBox(page, 15000);
  rec.check(S, 'the tour prompt appears on a fresh first run', !!b, b ? '' : 'no #tourCard on the main screen');
  if (b) await rec.shot(page, 'tour-prompt');
  let before = await notesSnap(page);
  if (b){
    const skip = b.getByRole('button', { name: TOUR.skip });
    rec.check(S, 'the card has a "No thanks" button', await skip.count() > 0);
    if (await skip.count()){
      await require('./helpers').clearToasts(page);
      await skip.first().click(); await page.waitForTimeout(500);
      rec.check(S, 'skip closes the prompt', !(await tourBox(page)));
      rec.check(S, '"No thanks" says "OK. You can take the tour any time: tap Take the tour next to the version number."', await require('./helpers').toastSeen(page, /OK\. You can take the tour any time: tap Take the tour next to the version number\./, 4000));
      const f = await page.evaluate(TOUR.seenFlag);
      rec.check(S, 'skip sets the "tour seen" flag', f === true, f === null ? 'window.__wa.tour not found' : 'flag=' + f);
      await page.reload(); await page.waitForTimeout(1500);
      rec.check(S, 'after a reload, the tour does not come back', !(await waitTourBox(page, 3000)));
      rec.check(S, '"No thanks" leaves notes, backup record and safety copies unchanged', ...(await sameAfterReload(page, before)));
    }
  }
  await done();
  // 2. Start goes through every step to Finish.
  ({ page, done } = await openFresh(env));
  b = await waitTourBox(page, 15000);
  if (!b) rec.skip(S, 'Start goes through all steps to Finish', 'no tour prompt');
  else {
    const start = b.getByRole('button', { name: TOUR.start });
    before = await notesSnap(page);
    if (!(await start.count())) rec.check(S, 'the prompt has a Start button', false, 'no button matching TOUR.start');
    else {
      await start.first().click(); await page.waitForTimeout(400);
      let steps = 0, finished = false;
      for (; steps < TOUR.maxSteps; steps++){
        const fin = page.getByRole('button', { name: TOUR.finish }).filter({ visible: true });
        if (await fin.count()){ await rec.shot(page, 'tour-last-step'); await fin.first().click(); finished = true; break; }
        const nx = page.getByRole('button', { name: TOUR.next }).filter({ visible: true });
        if (!(await nx.count())) break;
        if (steps === 0) await rec.shot(page, 'tour-step-1');
        await nx.first().click(); await page.waitForTimeout(400);
      }
      await page.waitForTimeout(500);
      rec.check(S, 'Start the tour goes through every screen (Next ›) and ends with Done', finished, 'steps tapped: ' + steps);
      const n = await page.evaluate(() => window.__wa.tour.steps.length);
      rec.check(S, '... the number of tour screens seen matches the app’s own step list (' + n + ')', finished && steps + 1 === n, 'screens seen: ' + (steps + 1));
      rec.check(S, 'after Done the tour is closed and the main screen is usable', finished && !(await tourBox(page)) && !!(await page.$('#app .row, #app .empty')));
      const f = await page.evaluate(TOUR.seenFlag);
      rec.check(S, 'finishing the tour sets the "tour seen" flag', f === true, 'flag=' + f);
      rec.check(S, 'finishing the tour leaves notes, backup record and safety copies unchanged', ...(await sameAfterReload(page, before)));
    }
  }
  await done();
  // 3. The phone's Back closes it.
  ({ page, done } = await openFresh(env));
  b = await waitTourBox(page, 15000);
  if (!b) rec.skip(S, 'phone Back closes the tour', 'no tour prompt');
  else {
    // The card is part of the main screen (Back there rightly leaves the app), so open the tour first.
    before = await notesSnap(page);
    await b.getByRole('button', { name: TOUR.start }).click(); await page.waitForTimeout(500);
    const opened = !!(await page.$('#modal .sheet.tour'));
    await env.back(page); await page.waitForTimeout(700);
    rec.check(S, 'phone Back closes an open tour screen and stays in the app', opened && !(await page.$('#modal .sheet.tour')) && !(await tourBox(page)) && !!(await page.$('#app')) && /witnessing-app/.test(page.url()), 'opened=' + opened + ' ' + page.url());
    const ts = await page.evaluate(() => window.__wa.tour);
    rec.check(S, '... and Back counts as "skipped" (the tour is not offered again)', ts && ts.state === 'done' && ts.how === 'skipped', JSON.stringify(ts));
    rec.check(S, 'closing the tour with Back leaves notes, backup record and safety copies unchanged', ...(await sameAfterReload(page, before)));
  }
  await done();
  // 4. "Does not appear for a profile that already has notes" is checked in the update check (step 1),
  //    where notes are made in the older version first and the app is then updated.
}

// ---------- Version 0.12.1 and newer ----------
// 0.12.1 (Judge-passed, live; spec: CHANGES.md and docs/TOUR-PLAN.md of 0.12.1) changed the tour: there is no card any more.
// For a brand-new copy the tour opens by itself, once, on the main screen (#modal .sheet.tour, "Step N of M", Skip tour /
// ‹ Back / Next › / Done). Skip tour, the phone's Back and Escape end it as "skipped" and show
// "You can take the tour any time: tap ? Help, then Take the tour."; Done ends it as "finished". It never opens by itself
// again. Help starts with a "🧭 Take the tour" button (#tourHelp) that replays it. The main screen ends with
// "PDF and more backup choices", the welcome text and the version line, last. People who update never get it.
// These checks mirror the app's own tests (v121.js T1-T6, T9, T19, J3, L1-L2).
const TOUR121_FROM = '0.12.1';
const LATER121 = 'You can take the tour any time: tap ? Help, then Take the tour.';
const TOUR_SEL = '#modal.show .sheet.tour';
const tourOpen = page => page.evaluate(sel => !!document.querySelector(sel), TOUR_SEL);
const tourState = page => page.evaluate(() => window.__wa && window.__wa.tour);
const stepInfo = page => page.evaluate(() => { const m = document.querySelector('#modal.show'); if (!m || !m.querySelector('.sheet.tour')) return null; const b = m.querySelector('.tbody');
  const bk = m.querySelector('[data-tour=back]'), nx = m.querySelector('[data-tour=next]'), sk = m.querySelector('[data-tour=skip]');
  return { key: b && b.getAttribute('data-step'), ind: ((m.querySelector('#tourStep') || {}).textContent || '').trim(), back: !!bk && !bk.hidden, next: nx ? nx.textContent.trim() : '', skip: !!sk && !sk.hidden && sk.textContent.trim() === 'Skip tour',
    focus: document.activeElement && document.activeElement.id }; });
const tapTour = async (page, which) => { await page.locator(TOUR_SEL + ' [data-tour=' + which + ']').click(); await page.waitForTimeout(400); };
const waitAutoTour = (page, ms) => page.waitForSelector(TOUR_SEL, { timeout: ms || 15000 }).then(() => true, () => false);
async function noTourAfterReload(page){ await page.reload(); await page.waitForSelector('#app .row, #app .empty', { timeout: 20000 }); await page.waitForTimeout(2500); return !(await tourOpen(page)); }
async function tour121Checks(env, rec, version){
  const S = 'Tour (0.12.1+)', H = require('./helpers');
  // A. A brand-new copy: the tour opens by itself; walk it to Done; it never opens by itself again; Help > Take the tour replays it.
  let { page, done } = await openFresh(env);
  let opened = await waitAutoTour(page, 20000), t = await tourState(page), s = await stepInfo(page);
  rec.check(S, 'a brand-new copy: the tour opens by itself on the main screen at "Step 1 of N" (state "offer", opened by itself)', opened && !!s && /^Step 1 of \d+$/.test(s.ind) && !!t && t.state === 'offer' && t.auto === true && await page.evaluate(() => location.hash === '#/' || location.hash === '' || location.hash === '#'), JSON.stringify(t) + ' ' + (s && s.ind));
  if (opened) await rec.shot(page, 'tour-auto-step-1');
  rec.check(S, '... there is no "New here?" card, no Start button, and no Take the tour on the main screen', await page.evaluate(() => !document.getElementById('tourCard') && !document.getElementById('tourLink') && !/New here\?|Take the tour|Start the tour/.test((document.getElementById('app') || {}).textContent || '')) && !(await page.getByRole('button', { name: /^Start the tour$/ }).count()));
  rec.check(S, '... focus is on the tour title, not a text box (no keyboard pops up)', !!s && s.focus === 'tourTitle');
  let before = await notesSnap(page);
  if (opened){
    const n = t.steps.length, steps = [s];
    for (let i = 1; i < n + 2; i++){ const cur = steps[steps.length - 1]; if (!cur || cur.next === 'Done') break; await tapTour(page, 'next'); steps.push(await stepInfo(page)); }
    rec.check(S, 'its screens read "Step 1 of ' + n + '" to "Step ' + n + ' of ' + n + '"; ‹ Back from step 2; Skip tour on every screen; the last button is Done', steps.length === n && steps.every((x, i) => x && x.ind === 'Step ' + (i + 1) + ' of ' + n && x.back === (i > 0) && x.skip && x.next === (i === n - 1 ? 'Done' : 'Next ›')), steps.map(x => x && (x.ind + '/' + x.back + '/' + x.next)).join(' | '));
    rec.check(S, '... the screens are welcome, (home-screen step on a phone browser,) backup, pdf', steps.length === n && steps[0].key === 'welcome' && steps[n - 2].key === 'backup' && steps[n - 1].key === 'pdf', steps.map(x => x && x.key).join(','));
    await H.clearToasts(page); await tapTour(page, 'next'); await page.waitForTimeout(500);
    t = await tourState(page);
    rec.check(S, 'Done closes it: state done/finished, and no "take the tour" message', !(await tourOpen(page)) && t.state === 'done' && t.how === 'finished' && !(await H.toastSeen(page, /take the tour any time/, 1500)), JSON.stringify(t));
    rec.check(S, '... focus goes to the search button on the main screen', await page.evaluate(() => !!document.activeElement && document.activeElement.classList.contains('searchbar') && document.activeElement.tagName === 'BUTTON'));
    rec.check(S, '... after a reload it does not open by itself again', await noTourAfterReload(page) && (await tourState(page)).how === 'finished');
    rec.check(S, 'finishing the tour leaves notes, backup record and safety copies unchanged', ...(await sameAfterReload(page, before)));
    await page.goto(env.base + '#/help'); await page.waitForSelector('#tourHelp', { timeout: 15000 }).catch(() => {});
    const hb = await page.evaluate(() => { const b = document.getElementById('tourHelp'); if (!b) return null; const r = b.getBoundingClientRect(), main = b.closest('main') || b.parentElement;
      const first = [...main.children].find(e => e.offsetHeight > 0 && !/^H[12]$/.test(e.tagName)); return { tag: b.tagName, text: b.textContent.trim(), h: r.height, top: r.top, bottom: r.bottom, vh: innerHeight, first: first === b }; });
    rec.check(S, 'Help starts with a "🧭 Take the tour" button, at least 44 px tall, on screen without scrolling', !!hb && hb.tag === 'BUTTON' && hb.text === '🧭 Take the tour' && hb.h >= 44 && hb.top >= 0 && hb.bottom <= hb.vh && hb.first, JSON.stringify(hb));
    if (hb){
      await page.locator('#tourHelp').click(); const re = await waitAutoTour(page, 8000); const s1 = await stepInfo(page);
      rec.check(S, 'Help > Take the tour opens the tour again at step 1', re && !!s1 && s1.ind === 'Step 1 of ' + n, s1 && s1.ind);
      if (re){ await tapTour(page, 'skip'); await page.waitForTimeout(400); }
      t = await tourState(page);
      rec.check(S, '... skipping that replay keeps the earlier answer (done/finished) and focus goes back to Help\'s Take the tour button', re && !(await tourOpen(page)) && t.state === 'done' && t.how === 'finished' && await page.evaluate(() => document.activeElement && document.activeElement.id === 'tourHelp'), JSON.stringify(t));
    }
  }
  await done();
  // B. Skip tour on the tour that opened by itself; then the new main-screen layout.
  ({ page, done } = await openFresh(env));
  opened = await waitAutoTour(page, 20000); before = await notesSnap(page);
  if (!opened) rec.check(S, 'Skip tour (second brand-new copy): the tour opened by itself', false, JSON.stringify(await tourState(page)));
  else {
    await H.clearToasts(page); await tapTour(page, 'skip'); t = await tourState(page);
    rec.check(S, 'Skip tour: it closes and the state is done/skipped', !(await tourOpen(page)) && t.state === 'done' && t.how === 'skipped', JSON.stringify(t));
    rec.check(S, '... it says exactly "' + LATER121 + '"', await H.toastSeen(page, new RegExp('^' + LATER121.replace(/[.?]/g, '\\$&') + '$'), 4000), await H.toastNow(page));
    rec.check(S, '... after a reload it does not open by itself', await noTourAfterReload(page) && (await tourState(page)).how === 'skipped');
    rec.check(S, 'skipping leaves notes, backup record and safety copies unchanged', ...(await sameAfterReload(page, before)));
    await page.goto(env.base + '#/'); await page.waitForSelector('#app .row', { timeout: 20000 }); await page.waitForTimeout(500);
    const order = await page.evaluate(() => { const main = document.querySelector('#app main') || document.getElementById('app'); const all = [...main.querySelectorAll('*')];
      const ix = el => el ? all.indexOf(el) : -1; const rows = [...main.querySelectorAll('.row')];
      return { search: ix(main.querySelector('.searchbar')), backup: ix(document.getElementById('bkbtn-home') || document.getElementById('bkbtn-remind')), firstRow: ix(rows[0]), lastRow: ix(rows[rows.length - 1]), restore: ix(document.getElementById('restorePanel')),
        pdf: ix([...main.querySelectorAll('button,a')].find(b => /PDF and more backup choices/.test(b.textContent))), intro: ix(main.querySelector('.lead.intro')), ver: ix(document.getElementById('ver')),
        verText: ((document.getElementById('ver') || {}).textContent || '').trim(),
        verLast: (() => { const v = document.getElementById('ver'); let e = v; if (!e) return false; while (e && e !== main){ if (e.nextElementSibling) return false; e = e.parentElement; } return true; })() }; });
    rec.check(S, 'main screen order: search, Back up, your sections, Restore from a backup, PDF and more backup choices, the welcome text, then the version line last', order.search >= 0 && order.search < order.backup && order.backup < order.firstRow && order.lastRow < order.restore && order.restore < order.pdf && order.pdf < order.intro && order.intro < order.ver && order.verLast && order.verText === 'Version ' + version, JSON.stringify(order));
    const bk = await page.evaluate(() => { const b = document.getElementById('bkbtn-home'); if (!b) return null; const r = b.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, vh: innerHeight, info: [...document.querySelectorAll('.bkinfo')].map(e => e.textContent.trim()) }; });
    rec.check(S, 'the Back up button is at the top, on screen without scrolling, and the only line under it is "No backup yet."', !!bk && bk.top > 0 && bk.bottom <= bk.vh && bk.info.length === 1 && bk.info[0] === 'No backup yet.', JSON.stringify(bk));
    await rec.shot(page, 'home-layout');
  }
  await done();
  // C. The phone's Back on step 2 of the tour that opened by itself.
  ({ page, done } = await openFresh(env));
  opened = await waitAutoTour(page, 20000); before = await notesSnap(page);
  if (!opened) rec.check(S, 'phone Back (third brand-new copy): the tour opened by itself', false, JSON.stringify(await tourState(page)));
  else {
    await tapTour(page, 'next'); const s2 = await stepInfo(page);
    await H.clearToasts(page); await env.back(page); await page.waitForTimeout(800); t = await tourState(page);
    rec.check(S, 'phone Back on step 2 closes the whole tour and stays on the main screen; state done/skipped', !!s2 && s2.ind.startsWith('Step 2') && !(await tourOpen(page)) && t.state === 'done' && t.how === 'skipped' && /witnessing-app/.test(page.url()) && await page.evaluate(() => /^(#\/?)?$/.test(location.hash)) && await page.locator('#app .searchbar').isVisible(), JSON.stringify(t) + ' ' + page.url());
    rec.check(S, '... it says exactly "' + LATER121 + '"', await H.toastSeen(page, new RegExp('^' + LATER121.replace(/[.?]/g, '\\$&') + '$'), 4000), await H.toastNow(page));
    rec.check(S, '... after a reload it does not open by itself', await noTourAfterReload(page));
    rec.check(S, 'closing the tour with Back leaves notes, backup record and safety copies unchanged', ...(await sameAfterReload(page, before)));
  }
  await done();
  // D. Escape (keyboard) on the tour that opened by itself.
  ({ page, done } = await openFresh(env));
  opened = await waitAutoTour(page, 20000);
  if (!opened) rec.check(S, 'Escape (fourth brand-new copy): the tour opened by itself', false, JSON.stringify(await tourState(page)));
  else {
    await H.clearToasts(page); await page.keyboard.press('Escape'); await page.waitForTimeout(500); t = await tourState(page);
    rec.check(S, 'Escape closes it as skipped (not finished)', !(await tourOpen(page)) && t.state === 'done' && t.how === 'skipped', JSON.stringify(t));
    rec.check(S, '... it says exactly "' + LATER121 + '"', await H.toastSeen(page, new RegExp('^' + LATER121.replace(/[.?]/g, '\\$&') + '$'), 4000), await H.toastNow(page));
    rec.check(S, '... after a reload it does not open by itself', await noTourAfterReload(page));
  }
  await done();
  // E. People who update never get it: checked in step 1 (notes made in the older version, then updated).
}

module.exports = { TOUR, TOUR_FROM, TOUR121_FROM, LATER121, tourBox, waitTourBox, dismissTourIfShown, tourChecks, tour121Checks, tourOpen, tourState };
