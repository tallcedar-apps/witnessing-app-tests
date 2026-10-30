'use strict';
// The 17-step phone checklist for version 0.11, automated where a
// browser can do it. Each check is labeled with its checklist step. Only made-up test data is used.
const H = require('./helpers');
const { dismissTourIfShown, tourChecks } = require('./tour');

const SEC = 'Phone test', TOP = 'Test topic', TEXT1 = 'This is a test part.';
const PDF_NOTICE = 'Your phone’s print screen will open next. To save a PDF, tap the yellow round PDF button (on Android, choose “Save as PDF” at the top if needed).';
const REPLACE_WARN = 'This replaces ALL notes on this phone with the backup. Any changes made since that backup will be lost.';
const NOT_MATCH_LINE = 'This file is labeled as a full backup, but what’s inside doesn’t match the label (it may have been changed or only partly saved), so it can only be added to your notes.';
const NO_SECTIONS_LINE = 'This file has no sections in it, so it can’t replace your notes.';
const SHARED_ONLY_ADD = 'This file was made before version 0.11 (or is a shared file), so it can only be added to your notes.';

async function home(page, env){ await page.goto(env.base + '#/'); await H.appReady(page); }
async function recover(page, env){ try { for (let i = 0; i < 3 && await H.modalOpen(page); i++) await H.closeResult(page); await home(page, env); } catch (e) {} }
const rowLoc = (page, title) => page.locator('#app .row', { hasText: title }).first();
async function openRow(page, title){ await rowLoc(page, title).locator('button.open, a.open, .open').first().click().catch(async () => rowLoc(page, title).click()); await page.waitForTimeout(400); }
async function ask(page, value){ await page.waitForSelector('#modal.show #mf0'); await page.fill('#mf0', value); await page.click('#modal .ok'); await page.waitForSelector('#modal.show', { state: 'hidden' }); await page.waitForTimeout(400); }
async function editorText(page){ return page.evaluate(() => { const e = document.getElementById('ed'); return e ? e.innerText.trim() : null; }); }
// Replace one word in the part's text by selecting it and typing over it (like a person would).
async function replaceWordInEditor(page, oldWord, newWord, env){
  await page.locator('#ed').click();
  // Android Chrome: tapping the box opens the on-screen keyboard, and while it slides in the keyboard resets
  // the cursor to where the finger tapped. Test setup only: wait until the visible screen area stops changing
  // size (the keyboard is fully open) before choosing the word, so the selection we make is the one typed over.
  if (env && env.android) await page.evaluate(() => new Promise(res => { const vv = window.visualViewport; let last = vv ? vv.height : 0, same = 0, n = 0;
    const t = setInterval(() => { const h = vv ? vv.height : 0; same = (h === last) ? same + 1 : 0; last = h; if (same >= 5 || ++n > 40) { clearInterval(t); res(); } }, 100); }));
  const select = () => page.evaluate(w => { const ed = document.getElementById('ed'); const tw = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT); let n;
    while ((n = tw.nextNode())){ const i = n.data.indexOf(w); if (i >= 0){ const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + w.length); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; } } return false; }, oldWord);
  const ok = await select();
  // Test setup only: give Android's keyboard a moment to pick up the new selection before typing.
  await page.waitForTimeout(300);
  if (ok && env && env.android){
    // Android: type over the selection with real key presses, the way a person with a keyboard would:
    // the selected word must still be selected, Backspace deletes it, then the new word is typed key by key.
    // Key presses go straight to the page, so the on-screen keyboard's own idea of the cursor can't move them.
    if (await page.evaluate(() => String(getSelection())) !== oldWord) { await select(); await page.waitForTimeout(300); }
    await page.keyboard.press('Backspace');
    await page.keyboard.type(newWord, { delay: 50 });
  } else if (ok) await page.keyboard.insertText(newWord);
  await page.waitForTimeout(300);
  if (env && env.android) console.log('NOTE [12] part text right after typing: ' + JSON.stringify(await editorText(page)));
  return ok;
}
async function appendInEditor(page, text){
  await page.locator('#ed').click();
  await page.evaluate(() => { const ed = document.getElementById('ed'); const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await page.waitForTimeout(300);
  await page.keyboard.insertText(text); await page.waitForTimeout(300);
}
const tapDone = async page => { await page.locator('header .tbtn[data-act="back"]').first().click(); await page.waitForTimeout(500); };
// Open Phone test > Test topic > Edit on the first part.
async function openPartEditor(page, env){
  await home(page, env); await openRow(page, SEC); await openRow(page, TOP);
  await page.locator('.card .editbtn, .card a[href*="#/e/"], .card button', { hasText: /Edit/ }).first().click(); await page.waitForSelector('#ed'); await page.waitForTimeout(300);
}
async function doBackup(page, env){
  // Tap whichever Back up button the main screen shows. With the stand-in picker the file goes to the save spot;
  // without it the app hands it to the share sheet stand-in.
  const b = page.locator('#bkbtn-remind, #bkbtn-home').first();
  if (env.picker){ await b.click(); return null; }
  return H.captureShared(page, () => b.click());
}
async function backupFile(page, env){ // latest full backup as {name,text}
  if (env.picker){ const names = await H.listSpotFiles(page); const n = names.find(x => /\.witness\.json$/.test(x)); return n ? { name: n, text: await H.readSpotFile(page, n) } : null; }
  const a = await H.sharedFiles(page); const f = [...a].reverse().find(x => /witnessing-notes-backup|my-witnessing-notes/.test(x.name)); return f || null;
}

async function runChecklist(env, rec){
  const errors = [];
  const V = env.expectedVersion;
  const step = async (label, fn) => { try { await fn(); } catch (e) { rec.check(label, 'step finished without a crash', false, e.message.split('\n')[0]); if (env.mainPage) { await rec.shot(env.mainPage, 'crash-' + label.replace(/\W+/g, '-')); await recover(env.mainPage, env); } } };

  // ---------- Step 1: update banner from an older version (on fresh data) ----------
  const step1 = async () => {
    if (!env.oldFiles){
      // OLD_REF set but not downloadable is a FAILURE, so the update check can never stop running unnoticed.
      if (env.oldRef) rec.check('1', 'the older version (' + env.oldRef + ') was fetched for the update check', false, env.oldError || 'not fetched');
      else rec.skip('1', 'update banner and toast', 'OLD_REF is not set');
      return;
    }
    const { page, done } = await env.fresh({ picker: false });
    attachLog(page, errors, 'update');
    const base = env.base;
    // The local test server serves the older index.html and sw.js until told to stop (see tests/serve.js).
    await H.serveOld(base, env.oldFiles); const served = 'older files served by the local test server';
    await page.goto(base); await H.appReady(page); await H.swReady(page); await page.reload(); await H.appReady(page);
    const v0 = await H.appVersion(page);
    rec.check('1', 'the older version (' + env.oldVersion + ') opens first and its offline helper is in control', H.shortVer(v0) === env.oldVersion, 'version=' + v0 + ' served=' + served);
    await page.locator('button', { hasText: 'New section' }).first().click(); await ask(page, 'Update test note');
    await home(page, env);
    await H.serveOld(base, null);
    await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); if (r) await r.update(); });
    const shown = await page.waitForSelector('#updnote:not([hidden])', { timeout: 30000 }).then(() => true, () => false);
    rec.check('1', 'the green note "New version ready — tap to update" appears', shown && /New version ready — tap to update/.test(await page.textContent('#updnote')));
    await rec.shot(page, 'update-banner');
    if (shown){
      await page.locator('#updgo').click();
      await page.waitForFunction(v => (window.__wa && String(window.__wa.version).split(' ')[0]) === v, V, { timeout: 25000 }).catch(() => {});
      await page.waitForSelector('#app .row', { timeout: 15000 }).catch(() => {});
      const toastOk = await H.toastSeen(page, new RegExp('Updated to version ' + V.replace(/\./g, '\\.') + '\\. Your notes are kept\\.'), 8000);
      await rec.shot(page, 'update-done');
      const c = await page.evaluate(async () => ({ caches: await caches.keys(), data: JSON.stringify(window.__wa.data) }));
      rec.check('1', 'one tap updates: "Updated to version ' + V + '. Your notes are kept." and the note made before the update is still there', toastOk && c.data.includes('Update test note'), await H.toastNow(page));
      rec.check('1', 'only the new offline copy (witnessing-app-v' + V + ') is left', JSON.stringify(c.caches) === JSON.stringify(['witnessing-app-v' + V]), JSON.stringify(c.caches));
      if (H.vge(V, '0.12')){
        const { waitTourBox } = require('./tour');
        const tb = await waitTourBox(page, 4000); const ts = await page.evaluate(() => window.__wa.tour);
        rec.check('Tour (0.12+)', 'the tour does not appear for someone who already has notes (updated from ' + env.oldVersion + ')', !tb && ts && ts.state === 'done' && ts.how === 'upgrade' && !ts.card, JSON.stringify(ts));
      }
    }
    await done();
  };
  // Android emulator only (env.retryClosedPage): if Chrome closes the test's page in the middle of step 1, say so
  // in the log and run the whole of step 1 once more on a fresh profile. Every check still runs and must pass;
  // anything already recorded (pass or fail) before the page closed stays in the results.
  await step('1', async () => {
    try { await step1(); }
    catch (e) {
      if (!env.retryClosedPage || !/has been closed|Target crashed|Page crashed/i.test(e.message)) throw e;
      rec.note('WARNING [1] the browser page closed in the middle of step 1 (' + e.message.split('\n')[0] + '); running step 1 once more on a fresh profile');
      if (env.onPageClosedRetry) await env.onPageClosedRetry();
      await step1();
    }
  });

  if (env.oldFiles) await H.serveOld(env.base, null).catch(() => {}); // always back to the version under test

  // ---------- Main flow: one fresh, empty profile ----------
  const { page, done } = await env.fresh({ picker: env.picker });
  env.mainPage = page; attachLog(page, errors, 'main');
  await page.goto(env.base + '?cb=' + Date.now()); await H.appReady(page);
  await dismissTourIfShown(page, rec);
  await step('2', async () => {
    const sw = await H.swReady(page);
    await page.goto(env.base); await H.appReady(page); await dismissTourIfShown(page, rec);
    rec.check('2', 'the app loads and shows its list of sections', await page.locator('#app .row').count() > 0);
    const ver = (await page.textContent('#ver')).trim();
    rec.check('2', 'the main screen says "Version ' + V + '"', ver === 'Version ' + V, ver);
    const c = await page.evaluate(async () => ({ caches: await caches.keys(), ctl: !!navigator.serviceWorker.controller }));
    rec.check('2', 'the offline helper is in control with the cache witnessing-app-v' + V, sw && c.ctl && JSON.stringify(c.caches) === JSON.stringify(['witnessing-app-v' + V]), JSON.stringify(c));
    await rec.shot(page, 'main-screen');
  });

  // ---------- Step 3: make the test section, topic, part; then Back through the screens ----------
  await step('3', async () => {
    await page.locator('button', { hasText: 'New section' }).first().click(); await ask(page, SEC);
    rec.check('3', 'New section "' + SEC + '" opens the section screen', /#\/s\//.test(await H.hash(page)) && (await page.textContent('h1')).includes(SEC), await H.hash(page));
    await page.locator('button', { hasText: 'New topic' }).first().click(); await ask(page, TOP);
    await page.waitForSelector('#ed', { timeout: 8000 });
    await page.locator('#ed').click(); await page.keyboard.insertText(TEXT1); await page.waitForTimeout(400);
    rec.check('3', 'New topic opens the editor for its first part, and typing works', (await editorText(page)) === TEXT1, await editorText(page));
    await tapDone(page);
    rec.check('3', 'Done goes back to the topic, which shows the part', /#\/t\//.test(await H.hash(page)) && (await page.textContent('#app')).includes(TEXT1), await H.hash(page));
    // As a person would: main list > section > topic > Edit, then the phone's Back three times.
    await openPartEditor(page, env); await rec.shot(page, 'part-editor');
    const seen = [];
    for (let i = 0; i < 3; i++){ await env.back(page); await page.waitForTimeout(600); seen.push(await H.hash(page)); }
    rec.check('3', 'phone Back steps back one screen at a time: part > topic > section > main list', /^#\/t\//.test(seen[0]) && /^#\/s\//.test(seen[1]) && /^#\/?$|^$/.test(seen[2]) && await page.locator('#app .row', { hasText: SEC }).count() > 0, seen.join(' , '));
    const d = JSON.parse((await H.st(page)).data); const s = d.find(x => x.title === SEC);
    rec.check('3', 'the section, topic, and part were saved', !!s && s.topics[0].title === TOP && /This is a test part\./.test(s.topics[0].subsections[0].html));
  });

  // ---------- Step 4: offline reload ----------
  await step('4', async () => {
    await H.swReady(page);
    const how = await env.offline(page, true);
    const reach = await H.reachesServer(page, env.base);
    rec.check('4', 'offline is real: the test page can no longer reach the server (' + how + ')', !reach);
    await page.reload(); await H.appReady(page).catch(() => {});
    const txt = await page.textContent('#app').catch(() => '');
    rec.check('4', 'with no connection, the app reopens with "' + SEC + '" and "Version ' + V + '"', txt.includes(SEC) && ((await page.textContent('#ver').catch(() => '')) || '').trim() === 'Version ' + V, txt.slice(0, 120));
    await rec.shot(page, 'offline-reload');
    await env.offline(page, false);
    await page.waitForTimeout(1000);
    rec.check('4', 'back online afterward', await H.reachesServer(page, env.base));
  });

  // ---------- Step 5: share one section (share sheet is a stand-in) ----------
  let sharedSection = null;
  await step('5', async () => {
    await home(page, env);
    await page.locator('header button, header a', { hasText: 'Share' }).first().click(); await page.waitForSelector('#pick');
    await page.locator('button', { hasText: 'Uncheck all' }).click();
    const sid = await page.evaluate(t => window.__wa.data.sections.find(s => s.title === t).id, SEC);
    await page.locator('input[data-pick="section"][data-id="' + sid + '"]').check();
    await rec.shot(page, 'share-screen');
    sharedSection = await H.captureShared(page, () => page.locator('button', { hasText: 'Send the checked notes' }).click());
    let j = null; try { j = JSON.parse(sharedSection.text); } catch (e) {}
    rec.check('5', 'Send the checked notes hands the share sheet one file with only "' + SEC + '"', !!j && j.sections.length === 1 && j.sections[0].title === SEC, sharedSection && sharedSection.name);
    if (sharedSection) H.saveFixture(rec, { name: 'shared-section-' + sharedSection.name, text: sharedSection.text });
    if (await H.modalOpen(page)) await H.closeResult(page);
  });

  // ---------- Steps 6-8 and 10: the save spot (stand-in picker; only where the picker exists) ----------
  if (env.picker){
    await step('6', async () => {
      await home(page, env);
      await page.locator('#bkbtn-remind, #bkbtn-home').first().click();
      const t = await H.mtext(page);
      rec.check('6', 'first Back up explains "Choose where to keep your backup" with "Choose a spot"', /Choose where to keep your backup/.test(t) && /Choose a spot/.test(t), t);
      await page.locator('#modal .ok').click();
      const ok = await H.waitToast(page, /Backed up to “my-witnessing-notes\.witness\.json”/);
      rec.check('6', 'after choosing a spot: "Backed up to “my-witnessing-notes.witness.json”."', ok, await H.toastNow(page));
      const f = await H.readSpotFile(page, 'my-witnessing-notes.witness.json');
      rec.check('6', 'the file in the save spot is a full backup with "' + SEC + '"', !!f && JSON.parse(f).kind === 'full-backup' && f.includes(SEC));
      await home(page, env);
      rec.check('6', 'the main screen shows "Last backup: … (today)"', /Last backup: .*\(today\)/.test(await page.textContent('#app')));
    });
    await step('7', async () => {
      await openPartEditor(page, env); await appendInEditor(page, ' Second'); await tapDone(page); await home(page, env);
      await page.locator('#bkbtn-home, #bkbtn-remind').first().click();
      const quiet = !(await page.waitForSelector('#modal.show', { timeout: 1500 }).then(() => true, () => false));
      const ok = await H.waitToast(page, /Backed up to/);
      const picks = await page.evaluate(() => +localStorage.__picks); const files = await H.listSpotFiles(page);
      rec.check('7', 'second Back up: no questions, same file updated (still one file)', quiet && ok && picks === 1 && files.length === 1 && (await H.readSpotFile(page, files[0])).includes('Second'), 'picks=' + picks + ' files=' + files.join());
    });
    await step('8', async () => {
      await page.evaluate(() => { localStorage.__perm = 'prompt'; localStorage.__permAfter = 'granted'; });
      await page.reload(); await H.appReady(page); await dismissTourIfShown(page, rec);
      await openPartEditor(page, env); await appendInEditor(page, ' Third'); await tapDone(page); await home(page, env);
      await H.clearToasts(page);
      await page.locator('#bkbtn-home, #bkbtn-remind').first().click();
      const t = await H.mtext(page, 5000).catch(() => '');
      const asked = /Tap Allow/.test(t) || await H.toastSeen(page, /Your phone asks once after a restart\. Tap Allow\./, 3000);
      if (await H.modalOpen(page)) await page.locator('#modal .ok').click();
      const ok = await H.toastSeen(page, /Backed up to/, 6000);
      rec.check('8', 'after a restart the app says "Your phone asks once after a restart. Tap Allow." and then saves', asked && ok, t || (await H.toastLog(page)).join(' | '));
      rec.check('8', '... and the stand-in "Allow" prompt was asked exactly once', (await page.evaluate(() => localStorage.__reqN)) === '1');
    });
  } else {
    for (const s of ['6', '7', '8']) rec.skip(s, 'save spot (file picker)', env.engineLabel + ' has no save-file picker; this browser uses the share sheet instead');
  }

  // ---------- Step 9: amber reminder after a one-word edit; Back up turns it blue ----------
  let backup1 = null;
  await step('9', async () => {
    if (!env.picker){ await home(page, env); const f = await doBackup(page, env); rec.check('9', 'Back up (no picker) hands the share sheet a dated backup file', !!f && /^witnessing-notes-backup-\d{4}-\d{2}-\d{2}\.witness\.json$/.test(f.name), f && f.name); }
    await openPartEditor(page, env); await appendInEditor(page, ' More'); await tapDone(page); await home(page, env);
    const b = await page.evaluate(() => { const x = document.getElementById('bkbtn-home') || document.getElementById('bkbtn-remind'); return x ? { cls: x.className, text: x.textContent, col: getComputedStyle(x).backgroundColor } : null; });
    rec.check('9', 'after editing a word, the Back up button turns amber and says "You have changes since your last backup"', !!b && /changed/.test(b.cls) && /246, 195, 68/.test(b.col) && /You have changes since your last backup/.test(b.text), JSON.stringify(b));
    await rec.shot(page, 'amber-button');
    await doBackup(page, env); if (env.picker) await H.waitToast(page, /Backed up to/);
    if (await H.modalOpen(page)) await H.closeResult(page);
    await page.waitForTimeout(500);
    const b2 = await page.evaluate(() => { const x = document.getElementById('bkbtn-home'); return x ? x.className : 'none'; });
    rec.check('9', 'after Back up, the button is back to normal (not amber)', !/changed/.test(b2) && !(await H.st(page)).changed, b2);
    backup1 = await backupFile(page, env);
    rec.check('9', 'the backup file is a full backup with the latest text', !!backup1 && JSON.parse(backup1.text).kind === 'full-backup' && backup1.text.includes('More'), backup1 && backup1.name);
    if (backup1) H.saveFixture(rec, { name: 'backup-' + backup1.name, text: backup1.text });
  });

  // ---------- Step 10: change and forget the save spot ----------
  if (env.picker){
    await step('10', async () => {
      await page.goto(env.base + '#/backup'); await page.waitForSelector('#bkbtn-page');
      await rec.shot(page, 'backup-screen');
      await page.evaluate(() => { localStorage.__pickName = 'other-spot.witness.json'; });
      await page.locator('button', { hasText: 'Change save spot' }).click();
      if (await page.waitForSelector('#modal.show', { timeout: 1500 }).then(() => true, () => false)) await page.locator('#modal .ok').click();
      const ok = await H.waitToast(page, /Backed up to “other-spot\.witness\.json”/);
      rec.check('10', 'Change save spot: picks a new spot and saves there', ok, await H.toastNow(page));
      await page.locator('button', { hasText: 'Forget save spot' }).click();
      const t = await H.mtext(page);
      rec.check('10', 'Forget save spot asks "Forget the save spot?" and says the file itself stays', /Forget the save spot\?/.test(t) && /file itself stays/.test(t), t);
      await page.locator('#modal .ok').click(); await page.waitForTimeout(500);
      rec.check('10', '... after forgetting, the app has no save spot and the file is still there', !(await H.st(page)).spot && (await H.listSpotFiles(page)).includes('other-spot.witness.json'));
      await page.evaluate(() => { delete localStorage.__pickName; });
    });
  } else rec.skip('10', 'change and forget save spot', env.engineLabel + ' has no save-file picker');

  // ---------- Back up screen and Step 11: the PDF notice (printing is stubbed) ----------
  await step('11', async () => {
    await home(page, env);
    await page.locator('button, a', { hasText: 'PDF and more backup choices' }).first().click(); await page.waitForSelector('#bkbtn-page');
    const t0 = await page.textContent('#app');
    rec.check('11', 'the Back up screen opens ("Back up / Save all", "Back up (can restore)", Last backup)', /Back up \/ Save all/.test(t0) && /Back up \(can restore\)/.test(t0) && /Last backup:/.test(t0));
    if (!env.picker) await rec.shot(page, 'backup-screen');
    await page.locator('button, a', { hasText: 'Open the printable view' }).first().click(); await page.waitForSelector('#ptools');
    await page.evaluate(() => { sessionStorage.__ciPrinted = '0'; });
    const printed = () => page.evaluate(() => +sessionStorage.__ciPrinted);
    const pdf = H.btn(page, 'Save as PDF or print');
    await pdf.click(); let t = await H.mtext(page);
    rec.check('11', 'the PDF notice shows the exact words, with Continue and Cancel', t.includes(PDF_NOTICE) && /Continue/.test(t) && /Cancel/.test(t), t);
    await rec.shot(page, 'pdf-notice');
    await H.mclose(page, '#modal .no');
    rec.check('11', 'Cancel: the print screen does not open', (await printed()) === 0);
    await pdf.click(); await H.mtext(page); await env.back(page); await page.waitForTimeout(600);
    rec.check('11', 'phone Back closes the notice and stays on the printable view, print not opened', !(await H.modalOpen(page)) && !!(await page.$('#ptools')) && (await printed()) === 0, await H.hash(page));
    await pdf.click(); await H.mtext(page); await page.locator('#modal .ok').click(); await page.waitForTimeout(600);
    rec.check('11', 'Continue: the print screen opens (stubbed)', (await printed()) === 1);
    // The app asks "Did a print screen open?" only if no print screen was seen; the stand-in reports one.
    const asked = await page.waitForSelector('#modal.show', { timeout: 4000 }).then(() => true, () => false);
    rec.check('11', 'after the print screen, the app does not wrongly ask "Did a print screen open?"', !asked || !/Did a print screen open/.test(await H.mtext(page)));
    if (await H.modalOpen(page)) await H.closeResult(page);
  });

  // ---------- Step 12: Restore > Add to my notes after changing one word ----------
  await step('12', async () => {
    if (!backup1){ rec.skip('12', 'restore Add', 'no backup file from step 9'); return; }
    await openPartEditor(page, env);
    const changed = await replaceWordInEditor(page, 'test', 'check', env); await tapDone(page); await home(page, env);
    rec.check('12', 'changed one word in the part ("test" to "check")', changed);
    const before = (await H.st(page)).data;
    await H.restoreFile(page, backup1); let t = await H.mtext(page);
    const ch = await H.choices(page);
    rec.check('12', 'Restore asks "Restore from this backup?" with "Add to my notes" (green, Safe, recommended) first', /Restore from this backup\?/.test(t) && ch.length === 2 && /Add to my notes/.test(ch[0].t) && /Safe, recommended/.test(ch[0].t) && /\bgo\b/.test(ch[0].c) && /Replace everything/.test(ch[1].t), JSON.stringify(ch));
    await rec.shot(page, 'restore-question');
    await env.back(page); await page.waitForTimeout(600);
    rec.check('12', 'phone Back closes the question and nothing changes', !(await H.modalOpen(page)) && (await H.st(page)).data === before);
    await H.restoreFile(page, backup1); await H.mtext(page); await H.choice(page, /Add to my notes/); t = await H.mtext(page);
    rec.check('12', 'Add: "Kept both versions of 1 part that differed" and "Nothing on this phone was changed or removed"', /Kept both versions of 1 part that differed/.test(t) && /Nothing on this phone was changed or removed/.test(t), t);
    await H.closeResult(page);
    const parts = await page.evaluate(t => { const s = window.__wa.data.sections.find(x => x.title === t); return s.topics[0].subsections.map(p => p.title + '|' + p.html.replace(/<[^>]+>/g, '')); }, SEC);
    rec.check('12', 'both versions are in the topic: yours first, then the backup’s marked "(from backup)"', parts.length === 2 && /check part/.test(parts[0]) && /\(from backup\)/.test(parts[1]) && /test part/.test(parts[1]), JSON.stringify(parts));
    await home(page, env); await openRow(page, SEC); await openRow(page, TOP); await rec.shot(page, 'after-add-both-versions');
    await home(page, env);
    const mid = (await H.st(page)).data;
    await H.restoreFile(page, backup1); await H.mtext(page); await H.choice(page, /Add to my notes/); t = await H.mtext(page);
    rec.check('12', 'Add the same file again: "nothing new to add" and nothing changes', /nothing new to add/i.test(t) && (await H.st(page)).data === mid, t);
    await H.closeResult(page);
    // A file made by the test itself (not from the app), merged with Add, and the merged result checked.
    const j = JSON.parse(backup1.text); const fx = { ...j }; delete fx.kind; delete fx.full; delete fx.sectionCount; delete fx.partCount; delete fx.checksum;
    fx.sections = [{ id: 'ci-fixture-s', title: 'CI fixture section', created: new Date().toISOString(), topics: [{ id: 'ci-fixture-t', title: 'CI fixture topic', subsections: [{ id: 'ci-fixture-p', title: 'CI fixture part', html: '<p>Made up by the test.</p>' }] }] }];
    const fixture = { name: 'ci-fixture.witness.json', text: JSON.stringify(fx) }; H.saveFixture(rec, fixture);
    await H.restoreFile(page, fixture); t = await H.mtext(page);
    const c2 = await H.choices(page);
    rec.check('12', 'a test-made fixture file: only "Add to my notes" is offered', c2.length === 1 && /Add to my notes/.test(c2[0].t), JSON.stringify(c2));
    await H.choice(page, /Add to my notes/); t = await H.mtext(page); await H.closeResult(page);
    const d = JSON.parse((await H.st(page)).data);
    const fs1 = d.find(x => x.title === 'CI fixture section');
    rec.check('12', 'after Add, the fixture section, topic, and part are in the notes and nothing else was lost', !!fs1 && fs1.topics[0].subsections[0].html.includes('Made up by the test.') && d.some(x => x.title === SEC) && d.length === JSON.parse(mid).length + 1, t);
  });

  // ---------- Step 13: Replace, Keep my notes, Replace, Undo ----------
  await step('13', async () => {
    if (!backup1){ rec.skip('13', 'replace and undo', 'no backup file'); return; }
    await home(page, env);
    const mine = (await H.st(page)).data;
    await H.restoreFile(page, backup1); await H.mtext(page); await H.choice(page, /Replace everything/); let t = await H.mtext(page);
    rec.check('13', 'Replace shows the warning with the exact words', t.includes(REPLACE_WARN), t);
    await rec.shot(page, 'replace-warning');
    await H.mclose(page, '#modal .no');
    rec.check('13', '"Keep my notes": nothing changed, no safety copy', (await H.st(page)).data === mine && (await H.st(page)).safety === 0);
    await H.restoreFile(page, backup1); await H.mtext(page); await H.choice(page, /Replace everything/); await H.mtext(page);
    await page.locator('#modal .ok').click(); await page.waitForTimeout(500); t = await H.mtext(page);
    rec.check('13', 'Replace everything: "Notes replaced" and it offers "Save the safety copy as a file"', /Notes replaced/.test(t) && /Save the safety copy as a file/.test(t), t);
    await H.closeResult(page);
    const after = (await H.st(page)).data;
    rec.check('13', 'the notes now match the backup (no fixture section, no "(from backup)" copy)', !after.includes('CI fixture section') && !after.includes('(from backup)') && after.includes(SEC));
    await home(page, env);
    const list = await page.textContent('#restorePanel');
    rec.check('13', 'Restore lists one safety copy "Before a replace" with Restore this copy, Save as a file, Delete', /Before a replace/.test(list) && /Restore this copy/.test(list) && /Save as a file/.test(list) && /Delete/.test(list) && (await H.st(page)).safety === 1, list.slice(0, 200));
    await page.locator('#restorePanel').scrollIntoViewIfNeeded(); await rec.shot(page, 'safety-copies');
    await H.btn(page, 'Undo last replace').click(); t = await H.mtext(page);
    rec.check('13', 'Undo asks "Undo the last replace?"', /Undo the last replace\?/.test(t), t);
    await page.locator('#modal .ok').click(); await page.waitForTimeout(500); t = await H.mtext(page); await H.closeResult(page);
    rec.check('13', 'Undo: "Replace undone" and the notes are exactly as before the replace', /Replace undone/.test(t) && (await H.st(page)).data === mine, t);
  });

  // ---------- Step 13b: forged "full backup" files can never Replace ----------
  // Three files are made by the test from its own backup (made-up data only). Each keeps "kind":"full-backup" but is
  // forged: (a) wrong sectionCount, (b) wrong checksum, (c) no sections. None may offer Replace; Add still works.
  await step('13b', async () => {
    if (!backup1){ rec.skip('13b', 'forged full backups', 'no backup file'); return; }
    await home(page, env);
    const j = JSON.parse(backup1.text);
    const extraSec = { id: 'ci-forged-s', title: 'CI forged count section', created: new Date().toISOString(), topics: [{ id: 'ci-forged-t', title: 'CI forged topic', subsections: [{ id: 'ci-forged-p', title: 'CI forged part', html: '<p>Forged count file.</p>' }] }] };
    // (a) one more section than the label says (sectionCount and checksum left as they were).
    const fa = { ...j, sections: [...j.sections, extraSec] };
    // (b) same counts, but one part's text changed, so the checksum no longer matches.
    const fb = JSON.parse(backup1.text); const fbPart = fb.sections.find(x => x.title === SEC).topics[0].subsections[0]; fbPart.html += '<p>Forged checksum text.</p>';
    // (c) labeled a full backup, but with no sections at all.
    const fc = { ...j, sections: [], sectionCount: 0, partCount: 0 };
    const cases = [
      { k: 'a', what: 'wrong section count', file: { name: 'ci-forged-count.witness.json', text: JSON.stringify(fa) }, line: NOT_MATCH_LINE, adds: 'CI forged count section' },
      { k: 'b', what: 'wrong checksum', file: { name: 'ci-forged-checksum.witness.json', text: JSON.stringify(fb) }, line: NOT_MATCH_LINE, adds: 'Forged checksum text.' },
      { k: 'c', what: '0 sections', file: { name: 'ci-forged-empty.witness.json', text: JSON.stringify(fc) }, line: NO_SECTIONS_LINE, adds: null }
    ];
    for (const c of cases){
      H.saveFixture(rec, c.file);
      const before = (await H.st(page)).data;
      await H.restoreFile(page, c.file);
      const shown = await page.waitForSelector('#modal.show', { timeout: 8000 }).then(() => true, () => false);
      const t = shown ? await H.mtext(page) : ''; const ch = shown ? await H.choices(page) : [];
      const noReplace = !ch.some(x => /Replace/.test(x.t)) && !/Replace everything/.test(t);
      rec.check('13b', '(' + c.k + ') forged full backup with ' + c.what + ': "Replace everything" is NOT offered', shown && noReplace, JSON.stringify(ch));
      if (c.adds){
        rec.check('13b', '(' + c.k + ') ... it explains why: "' + c.line.slice(0, 60) + '…"', t.includes(c.line), t);
        await rec.shot(page, 'forged-' + c.k);
        const addOk = ch.length === 1 && /Add to my notes/.test(ch[0].t);
        if (addOk){ await H.choice(page, /Add to my notes/); await H.mtext(page); await H.closeResult(page); }
        else if (await H.modalOpen(page)) await H.mclose(page, '#modal .no');
        const after = (await H.st(page)).data;
        rec.check('13b', '(' + c.k + ') ... "Add to my notes" is offered and works (the forged file’s new text is added, nothing lost)', addOk && after.includes(c.adds) && JSON.parse(after).length >= JSON.parse(before).length, JSON.stringify(ch));
      } else {
        rec.check('13b', '(' + c.k + ') ... it says "' + c.line + '" (or refuses the file), and nothing changes', (t.includes(c.line) || /Couldn’t use that file/.test(t)), t);
        await rec.shot(page, 'forged-' + c.k);
        if (await H.modalOpen(page)){ const add = (await H.choices(page)).some(x => /Add to my notes/.test(x.t)); if (add){ await H.choice(page, /Add to my notes/); await H.mtext(page).catch(() => ''); } }
        for (let i = 0; i < 3 && await H.modalOpen(page); i++) await H.closeResult(page);
        rec.check('13b', '(' + c.k + ') ... the notes are unchanged afterward', (await H.st(page)).data === before);
      }
      await home(page, env);
    }
  });

  // ---------- Step 14: three safety copies, then save the oldest first ----------
  await step('14', async () => {
    if (!backup1){ rec.skip('14', 'safety copies', 'no backup file'); return; }
    let blocked = false, tries = 0, t = '';
    while (tries++ < 5){
      await H.restoreFile(page, backup1); await H.mtext(page); await H.choice(page, /Replace everything/); t = await H.mtext(page);
      if (!(await page.$('#modal .ok')) || /To make room, first save the oldest one/.test(t)){ blocked = true; break; }
      await page.locator('#modal .ok').click(); await page.waitForTimeout(500); await H.mtext(page); await H.closeResult(page);
    }
    rec.check('14', 'once 3 safety copies are kept, Replace first asks to save the oldest one (no Replace button yet)', blocked && (await H.st(page)).safety === 3 && /You already have 3 safety copies/.test(t), t);
    await rec.shot(page, 'save-oldest-first');
    const saved = await H.captureShared(page, () => H.choice(page, /Save the oldest copy/));
    rec.check('14', '"Save the oldest copy as a file first" saves a safety-copy file', !!saved && /^safety-copy-\d{4}-\d{2}-\d{2}-\d{4}\.witness\.json$/.test(saved.name), saved && saved.name);
    t = await H.mtext(page);
    rec.check('14', '... then the question comes back with Replace everything', !!(await page.$('#modal .ok')) && /removed from the app to make room/.test(t), t);
    await H.mclose(page, '#modal .no');
    await home(page, env);
    rec.check('14', 'the oldest copy is marked "Saved as a file on" a date', /Saved as a file on/.test(await page.textContent('#restorePanel')));
  });

  // ---------- Step 15: a shared file offers only Add ----------
  await step('15', async () => {
    if (!sharedSection){ rec.skip('15', 'shared file', 'no shared file from step 5'); return; }
    await home(page, env);
    await H.restoreFile(page, sharedSection); const t = await H.mtext(page); const ch = await H.choices(page);
    rec.check('15', 'the shared section file offers only "Add to my notes", with the one-line reason', ch.length === 1 && /Add to my notes/.test(ch[0].t) && t.includes(SHARED_ONLY_ADD), t);
    await rec.shot(page, 'shared-file-add-only');
    await H.mclose(page, '#modal .no');
  });

  // ---------- Step 16: Help > Restoring ----------
  await step('16', async () => {
    await home(page, env);
    await page.locator('header button, header a', { hasText: 'Help' }).first().click(); await page.waitForSelector('#restoreHelp');
    const t = await page.textContent('#restoreHelp');
    rec.check('16', 'Help has "Restoring" with Add to my notes, Replace everything, and Safety copies', /Restoring/.test(t) && /Add to my notes/.test(t) && /Replace everything with this backup/.test(t) && /Safety copies/.test(t) && /keeps the last 3/.test(t), t.slice(0, 150));
    await page.locator('#restoreHelp').scrollIntoViewIfNeeded(); await rec.shot(page, 'help-restoring');
  });

  // ---------- Step 17: clean up; delete asks first, Back closes the question ----------
  await step('17', async () => {
    await home(page, env);
    await page.locator('button', { hasText: /Change order, names, or delete/ }).first().click(); await page.waitForTimeout(300);
    const sid = await page.evaluate(t => window.__wa.data.sections.find(s => s.title === t).id, SEC);
    const del = page.locator('button[data-act="delete"][data-kind="section"][data-id="' + sid + '"]');
    await del.click(); let t = await H.mtext(page);
    rec.check('17', 'delete asks first ("Delete the section “' + SEC + '”…?")', /Delete the section “Phone test”/.test(t), t);
    await env.back(page); await page.waitForTimeout(600);
    rec.check('17', 'phone Back closes the question; the section is still there', !(await H.modalOpen(page)) && (await H.st(page)).data.includes(SEC));
    await del.click(); await H.mtext(page); await page.locator('#modal .ok').click();
    const ok = await H.waitToast(page, /Section deleted/);
    rec.check('17', 'Delete removes the section', ok && !JSON.parse((await H.st(page)).data).some(x => x.title === SEC));
  });

  rec.check('all', 'no page errors or console errors during the checklist', errors.length === 0, errors.join(' | '));
  // The app's Content-Security-Policy must be exactly the expected one (a loosened or missing CSP fails).
  await home(page, env).catch(() => {});
  const csp = await H.readCsp(page).catch(() => null);
  rec.check('all', 'the app’s Content-Security-Policy is present and exactly as expected', csp === H.EXPECTED_CSP, csp === null ? 'no CSP meta tag' : csp);
  await done();
  env.mainPage = null;

  // ---------- Tour (0.12 and newer only) ----------
  try { await tourChecks(env, rec, V); } catch (e) { rec.check('Tour (0.12+)', 'tour checks finished without a crash', false, e.message.split('\n')[0]); }

  // Over the whole run (every profile, the tour too): nothing may contact any site except the local test server.
  const out = env.outside || [];
  rec.check('all', 'no requests left the test computer (only ' + (env.allowedHosts || H.LOCAL_HOSTS).join(', ') + ')', out.length === 0, [...new Set(out)].slice(0, 5).join(' '));
}
function attachLog(page, list, tag){ H.attachErrorLog(page, list, tag); }  // allows only the local test server

module.exports = { runChecklist };
