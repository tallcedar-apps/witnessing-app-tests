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
  const b = await waitTourBox(page, 2500);
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

module.exports = { TOUR, TOUR_FROM, tourBox, waitTourBox, dismissTourIfShown, tourChecks };
