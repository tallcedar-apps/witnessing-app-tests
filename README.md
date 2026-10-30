# Phone checks for My Witnessing Notes

This repo holds automatic checks for the **My Witnessing Notes** web app
(<https://tallcedar-apps.github.io/witnessing-app/>). GitHub runs them for free on its own computers. They
open the app in phone-sized browsers, in real Chrome inside an Android emulator, and in real Mobile Safari inside
an iPhone Simulator. Then they tap through the same steps as the phone checklist and report pass or fail for each one.

**This repo is public** (`tallcedar-apps/witnessing-app-tests`). Nothing in it is private: there are no notes,
names, emails, or phone numbers. It holds only test code and made-up test data.

## What it tests

Each run gets the app's code from `tallcedar-apps/witnessing-app` (the `main` branch unless you pick another
when you start a run). It then serves that copy on the test computer's own **localhost**, so it tests exactly
that code, not whatever happens to be live. A separate, read-only check then opens the live site.

| Job | Where it runs | What it uses |
|---|---|---|
| Chromium and WebKit at phone size | Linux | Playwright's Chromium (Android size) and Playwright's WebKit (iPhone size). WebKit is the engine inside Safari, **but it is not real Safari**. |
| Real Chrome in the Android emulator | Linux with hardware speed-up (KVM) | Real Chrome on an emulated Android phone (Android 14, `google_apis` image). The phone reaches the test copy through `adb reverse`. If that image ever lacks Chrome, the job retries once on the `google_apis_playstore` image and shows a warning. If the emulator program itself vanishes mid-run (a known emulator problem, see ci-runs notes), the whole checklist is run once more on a new emulator, with a warning; every check must pass again. That retry happens only if every FAIL of the first try is emulator/adb trouble; if any real check failed, there is no retry and the job fails with the reason. **Fresh starts on Android:** Chrome is started once and reused. Before each group of checks, every tab is closed, the test site's service workers are unregistered, and all of the test site's saved data is deleted from inside Chrome. A marker is saved just before the clear. Then a recorded check proves the marker is gone and the site has nothing left (IndexedDB, service workers and no controlling one, offline copies, local and session storage, file storage, cookies, storage use about 0, not persistent, no permissions granted) and only one tab is open. Chrome is no longer force-stopped and wiped (`pm clear`) between fresh starts, because the emulator kept vanishing right at that moment. That old wipe is used only as a fallback, with a warning, if the site can't be confirmed empty; if it still isn't empty, the check fails. `tests/fresh-selftest.js` (run in the Linux job) proves this check catches leftover data. The `android_fresh` run input (`clear`, the normal one, or `wipe`) can switch to the old full wipe for every fresh start, for a side-by-side comparison. |
| Negative check: a page-crashing copy of the app (own Android emulator) | Linux with KVM | Its own job and its own fresh emulator. It builds a copy of the app that crashes the page on purpose and runs step 1 once, with no retry. The job passes only if Chrome reports the page crash and step 1 FAILS, with no emulator or adb trouble. This proves an app-caused crash cannot slip through as a pass or a "system" retry. |
| iPhone checks | macOS | Playwright WebKit with iPhone settings (**WebKit, not real Safari**), plus real Mobile Safari in the iOS Simulator (**screenshots only, not checked**). An experimental extra step drives the Simulator's Safari with safaridriver; it **does not affect pass/fail**, and if it fails the run shows a yellow warning. |
| Live site smoke check | Linux | Opens the live site in fresh, empty browsers. It checks that the live `index.html` and `sw.js` are byte for byte the files on the app's main branch (sha256), that the page loads, shows the expected version, and reopens with no internet. It never types or saves anything. |

In each browser, the tests start with a brand-new, empty profile and use only made-up test data ("Phone test",
"Test topic", "CI fixture section"). Each one checks:

- **The version** on the main screen ("Version 0.11"), and that the offline helper is installed with the matching copy.
- **The update note** (checklist step 1): it opens an older version (0.10) first, then the new one. It checks the green
  "New version ready — tap to update" note, the "Updated to version … Your notes are kept." message, that the note made
  beforehand is still there, and that only the new offline copy is left.
- **Opening a section, a topic, and a part**, typing, Done, and Back one screen at a time.
- **No internet**: it cuts the connection, proves the app can't reach the server, then reopens the app from its offline copy.
- **Share a section**: the file handed to the share menu holds only "Phone test".
- **Back up**: the first-time explanation, choosing a spot, the "Backed up to …" message, a second backup with no
  questions (still one file), the "Tap Allow" message after a restart, the amber reminder, and changing or forgetting
  the save spot. Where the browser has no save-file picker (WebKit), it checks the share-menu backup instead.
- **The Back up screen** and the PDF notice: the exact words, and that Cancel, Back, and Continue each work.
- **Restore**:
  - **Add**, with a one-word difference: both versions are kept, and the backup's copy is marked "(from backup)".
  - **Add again**: "nothing new to add".
  - **Add a test-made file**: the merged result is checked.
  - **Forged "full backup" files** (made by the test from its own backup): one with the wrong section count, one with
    the wrong checksum, and one with no sections. None of them may offer **Replace**; each shows the app's reason, and
    **Add** still works where there is something to add.
- **Replace**: the exact warning, Keep my notes, Replace, Undo, the safety copies list, the 3-copy limit, and
  "Save the oldest copy as a file first".
- **A shared file offers only Add**, the **Help** text about restoring, and **deleting a section** (it asks first, and Back cancels).
- **No errors** show up in the browser's error log. Network errors are ignored only for the test's own server
  (during the planned no-internet steps); a failed request to any other site counts as an error.
- **No outside requests**: every request from every test browser is watched. Any request to a site other than the
  local test server (or, in the live check, `tallcedar-apps.github.io`) fails the run.
  Besides the browser's request events, each page also reports every file it tried to load (Chromium doesn't report
  some loads, such as a hidden image, as request events).
- **The Content-Security-Policy** in the page must match the app's expected policy exactly (it is written out in
  `tests/lib/helpers.js` as `EXPECTED_CSP`). If the app changes its policy on purpose, update that line too.
- **The update check can't quietly stop.** If the older version (`OLD_REF`) can't be downloaded, step 1 fails.
- **The first-time tour, version 0.12.1 and later** (the current live version; it has no card):
  - On a brand-new copy the tour opens by itself on the main screen at "Step 1 of N", with focus on its title. There is
    no "New here?" card, no Start button, and no Take the tour on the main screen.
  - Every screen shows "Step i of N", **Skip tour**, **‹ Back** (from step 2) and **Next ›**; the last one says **Done**.
    The screens are welcome, (the home-screen step on a phone browser,) backup, PDF.
  - **Done** ends it as "finished" with no message and puts focus on the search button.
  - **Skip tour**, the phone's Back (on step 2) and Escape each end it as "skipped" and say exactly
    "You can take the tour any time: tap ? Help, then Take the tour."
  - After any of these, a reload doesn't bring it back by itself.
  - Help starts with a **🧭 Take the tour** button (at least 44 px tall, on screen) that replays it from step 1; skipping
    the replay keeps the earlier answer and puts focus back on that button.
  - Main screen order: search, Back up, your sections, Restore from a backup, PDF and more backup choices, the welcome
    text, and the version line last. The only line under Back up is "No backup yet.".
  - Done, Skip and Back leave the notes, the backup record, the safety copies and the save spot unchanged (after a reload).
  - Someone who updates from 0.10 with notes gets exactly "Updated to version 0.12.1. Your notes are kept. New: a short
    tour. Tap ? Help, then Take the tour." and the tour never opens by itself, not even after a reload.
- **The first-time tour, version 0.12 only** (kept so 0.12 can still be tested with `app_ref` = its full commit ID and
  `expected_version` = `0.12`): the "New here?" card, **No thanks** with its message, **Start the tour** through every
  screen to **Done**, the phone's Back, unchanged notes, and no tour for someone who updated from 0.10 with notes.

  On version 0.11 these checks show as "skipped". The other checks close the tour if it shows up and don't fail if it doesn't.

## What it can't test (real phone only)

The tests can't do these, so they still need a check on a real phone:

- **Add to Home Screen**, and opening the app from its icon (including iOS Home Screen app mode).
- **The real share menu.** The tests use a stand-in that catches the file instead of opening the menu.
- **The Android file picker** (the real "save to Downloads" screen) and the **Allow** permission prompt.
  On Chromium and the emulator, the tests use a stand-in picker that saves into the browser's private test storage.
- **The real on-screen keyboard** (the tests type directly into the page).
- **Real-phone speed** and how it feels to use.
- **Samsung Internet.**
- **Printing and saving a PDF.** The tests check the notice and buttons, but the print screen itself is a stand-in.
- "One more Back at the main list leaves the app," and truly **restarting the phone**. The tests fake a restart by
  making the save spot ask for permission again.

## Why a separate public repo

- **Free.** GitHub-hosted runners, including macOS, cost nothing on public repos.
- **Safe.** The app's own repo, and the GitHub Pages site built from it, never get a test workflow or any write
  access from it. If something here went wrong, it couldn't change or break the live app.
- **Tidy.** The app repo stays just the app. Test files, screenshots, and run history live here.

## Secrets and permissions

- **No secrets at all.** The app repo is public, so the tests can read it without a password or token.
- The workflow sets `permissions: contents: read` and nothing else. It can't push, create releases, change GitHub Pages,
  or deploy anything. Every checkout uses `persist-credentials: false`, so the read-only token isn't even left on disk.
- The two typed-in inputs are checked first. **app_ref** may use only letters, digits, `.`, `_`, `/`, and `-` (up to 100,
  no `..`), and a commit must be its full 40-character ID (a shortened one like `c0b3e2f` is refused with a clear message,
  because the app checkout can't use it; branch and tag names are fine); **expected_version** must look like `0.12` or `0.12.1`, or be empty. Anything else stops the run. Inputs reach the
  scripts only through environment variables.
- It starts only on a push to this repo, or when you start a run by hand ("Run workflow"). It never runs for other
  people's pull requests. A daily run is in the file but turned off; remove the `#` marks to turn it on.
- Each outside building block (a GitHub "action") is locked to an exact version by its full commit ID, so it can't
  change under us.
- The local test server listens only on the test computer itself (`127.0.0.1`, port 8931; never port 8765).

## Cost

$0. GitHub-hosted runners are free for public repos, including macOS. On a private repo, macOS minutes would count
10 times against the monthly free minutes. That's why this repo should stay public. The macOS job is kept short anyway
(about 10–15 minutes).

## How to read the results

1. Open the repo on GitHub and click **Actions**, then the latest **Phone checks** run.
2. A green check means everything passed. A red X means at least one check failed.
3. Scroll down the run page to the **Summary**. There's one table per browser, with a row for each check:
   ✅ PASS, ❌ FAIL, or ⏭️ SKIP. Each row shows the checklist step number. A failed row says what the test saw.
4. At the bottom, under **Artifacts**, download each job's results. They're kept for 7 days. They hold
   **screenshots, logs** (the test server log, the Android logcat, the safaridriver log, and each run's results file),
   and the **test files** the tests made (backups and forged backups of made-up test data). Nothing in them is personal.

To test a different branch or check a version number, click **Run workflow**. Fill in **app_ref** (for example
`main`, a tag, or a full 40-character commit ID) and, if you like, **expected_version** (for example `0.12`). If the app says a different version, the run fails
right away with a clear message.

## The phone checklist, step by step

This maps the 17 steps of the phone checklist for version 0.11.

| Step | What it checks | Coverage | Why |
|---|---|---|---|
| 1 | Get the update (green note, one tap, "Updated to version …") | Partly automated | It opens 0.10, then the new version, and checks the note, the message, kept notes, and the offline copy. Opening from the Home Screen icon is real phone only. |
| 2 | "Version 0.11" on the main screen | Automated | It reads the version text and checks the offline copy's name. |
| 3 | Back one screen at a time | Automated (almost all) | Browser Back on Linux and Mac, and the real Android Back key in the emulator. "One more Back leaves the app" is real phone only. |
| 4 | Works with no internet | Partly automated | It cuts the connection (airplane mode on the emulator), proves it's offline, and reopens. Opening from the Home Screen icon is real phone only. |
| 5 | Share a section | Partly automated | It checks the file handed to the share menu. The real share menu is real phone only. |
| 6 | First backup, choose a spot | Partly automated | It checks the wording and the saved file, using a stand-in picker. The real Android save screen is real phone only. |
| 7 | Second backup, no questions, still one file | Partly automated | It uses a stand-in picker. Looking in My Files > Downloads is real phone only. |
| 8 | Restart, then Allow | Partly automated | It fakes the restart and the Allow prompt, then checks the message. A real restart and the real prompt are real phone only. |
| 9 | Amber reminder | Automated | It checks the amber color, the words, and that the button turns normal after a backup. |
| 10 | Change and forget the save spot | Partly automated | It uses a stand-in picker. The real folder choice is real phone only. |
| 11 | PDF notice (Cancel, Back, Continue) | Partly automated | It checks the exact words and the three buttons. The real print and PDF screen is real phone only. |
| 12 | Restore: Add with a one-word difference | Automated | It uses the backup file the test made, plus a made-up file. |
| 13 | Replace, the warning, and Undo | Automated | It checks the exact warning words and the notes before and after. |
| 13b | Forged full backups can't Replace (extra check) | Automated | Wrong section count, wrong checksum, and no sections: no Replace button, the app's reason is shown, and Add still works. |
| 14 | Safety copies list and the 3-copy limit | Automated | It replaces until the limit, then checks "Save the oldest copy as a file first". (The step's wording is a little unclear about the count, so the test keeps going until the limit appears.) |
| 15 | A shared file offers only Add | Automated | It uses the file caught in step 5. |
| 16 | The Help text about restoring | Automated | It checks the words in Help. |
| 17 | Delete a section (asks first; Back cancels) | Automated | It checks the question, that Back cancels, and that Delete removes the section. |

## Files

- `.github/workflows/phone-checks.yml`: the workflow (the four jobs above).
- `tests/serve.js`: the tiny local web server for the copy of the app being tested (no extra packages).
- `tests/run-browser.js`: runs the checklist in Playwright Chromium or WebKit at phone size.
- `tests/run-android.js`: runs the checklist in real Chrome in the Android emulator.
- `tests/fresh-selftest.js`: proves the Android fresh-start check catches leftover data and fails if the data can't be cleared. `FRESH_MODE=reuse ENGINE=chromium node tests/run-browser.js` runs the whole checklist in Chromium using the same fresh-start method.
- `tests/live-smoke.js`: the read-only live site check.
- `tests/ios-safari-smoke.js`: the experimental real-Safari check in the iOS Simulator.
- `tests/lib/checklist.js`: the checklist steps. `tests/lib/tour.js`: the tour checks.
  `tests/lib/helpers.js`: shared helpers and the stand-ins for the share menu, file picker, and print screen.
- `ci/*.sh`: small scripts for the version check, the server, the emulator, and the Simulator.
- `ci/negative-checks.sh`: the breakage checks (see below). Run by hand, not in the workflow.

### The tour checks

The 0.12.1 checks are in `tour121Checks` in `tests/lib/tour.js` (with the message text in `LATER121`); the app's version
decides which set runs. The older `TOUR` block at the top of that file matches the 0.12 app: the
`#tourCard` card ("New here? …", **Start the tour** / **No thanks**), the tour screens in the app's message box
(`#modal .sheet.tour`: **Skip tour**, **‹ Back**, **Next ›**, **Done**), and the app's own tour setting
(`window.__wa.tour.state`). If the tour's words or buttons change, update only that block.

Waiting for the tour to open by itself allows 20 seconds from page load. If the browser driver itself reports an error
during that wait (seen once in Linux WebKit), the wait goes on until the same 20-second deadline, the error text is
shown in the check's details, and a visible warning is recorded if the tour then opens. The deadline is never extended.

## Breakage checks (proving the tests can fail)

`ci/negative-checks.sh` makes broken copies of the app in a temporary folder and runs the Chromium checklist against
each one. Every broken copy **must** make the checklist fail; the script reports any that pass and then exits 1.
It never changes the app's own files.

```bash
npm ci && npx playwright install chromium
bash ci/negative-checks.sh path/to/app-copy        # e.g. a clone of tallcedar-apps/witnessing-app
```

The broken copies: wrong version, Add imports nothing, any file can Replace, only 1 safety copy kept, no offline
support, Replace skips the safety copy, CSP removed plus an outside image, count/checksum check removed, the
older version not downloadable, finishing the tour adds a section (0.12 and later), and six for the 0.12.1 tour (shown as "n/a" on older versions):
Escape counts as finished, the tour never opens by itself, Skip shows the old 0.12 message, Help has no Take the tour
button, the answer isn't saved, the tour opens by itself for people who update, the tour doesn't resume after
add-to-home-screen, closing mid-tour gives no message, finishing in another window is ignored, Help doesn't say
"Downloads", and a brand-new copy shows a false "New version ready" note. Each uses its own local port (8941 and up,
or `NEG_PORT`; never 8765). Each case must fail on **its own** check: the script has the exact FAIL line each case
must hit (`EXPECT`). A case that fails some other way is `CAUGHT-WRONG`, one with no expected line is
`NO-EXPECTED-CHECK`, and one whose test server didn't start is `SERVER-FAILED`; all of these count as not caught.

**Tour fresh-copy loop (WebKit):** the WebKit runs open 30 brand-new copies in a row (`TOUR_LOOP` changes the
number) and require the tour to open by itself every time, with no "New version ready" note. On 0.12.1 this is
expected to fail now and then: that's a real app bug (the run C miss), to be fixed in 0.12.2.

## Commits

Commits to this repo use only the GitHub no-reply identity of `tallcedar-apps`
(`<id>+tallcedar-apps@users.noreply.github.com`), set per commit, for example
`git -c user.name="tallcedar-apps" -c user.email="<id>+tallcedar-apps@users.noreply.github.com" commit …`.
Check with `git log --format='%an <%ae>'` before pushing; no other name or email should appear.
