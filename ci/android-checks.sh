#!/usr/bin/env bash
# Runs inside the Android emulator step (reactivecircus/android-emulator-runner).
# Env: APP_PORT (default 8931), EXPECTED_VERSION, OLD_REF, ANDROID_OUT (default results/android),
#      ANDROID_IMAGE (a label for the logs, like google_apis)
# Exit codes: 0 all passed, 1 a check failed, 2 bad setup, 3 Chrome is missing on this system image
# (the workflow then retries once on the google_apis_playstore image).
set -uo pipefail
# Mode: "main" (default) runs the checklist; "negative" runs ONLY the crash-on-purpose negative check, in its own job
# with its own fresh emulator, so neither can disturb the other.
mode="${1:-main}"
port="${APP_PORT:-8931}"
out="${ANDROID_OUT:-results/android}"
mkdir -p "$out"
if [[ "$port" == "8765" ]]; then
  echo "::error::Port 8765 is not allowed for this project."
  exit 2
fi
adb wait-for-device
adb shell getprop ro.build.version.release | sed 's/^/Android version: /'
if ! adb shell pm list packages com.android.chrome | tr -d '\r' | grep -q '^package:com.android.chrome$'; then
  echo "Chrome is not installed on the ${ANDROID_IMAGE:-current} emulator image."
  adb shell pm list packages | grep -iE 'chrome|webview|browser' || true
  echo "${ANDROID_IMAGE:-unknown}" > results/android-chrome-missing.txt
  exit 3
fi
# Let Chrome read its command-line file (needed for automation on a non-rooted build).
adb shell am set-debug-app --persistent com.android.chrome || true
# Emulator setup only: don't let system "isn't responding" dialogs (seen: Pixel Launcher) cover Chrome.
adb shell settings put global hide_error_dialogs 1 || true
adb shell settings put secure anr_show_background 0 || true
# Make sure the emulator starts online. (Playwright itself skips Chrome's first-run screens.)
adb shell cmd connectivity airplane-mode disable || true
# The emulator's "localhost:$port" now means the runner's local test server.
adb reverse "tcp:$port" "tcp:$port"
adb logcat -G 16M || true
# Test setup only: let Google Play services finish its after-boot restart before Chrome is used (see ci/android-settle.sh).
bash ci/android-settle.sh "before the tests" | tee "$out/settle-wait.txt"
# Diagnostics only: keep the start-up part of the system log, then start a clean log for the tests.
timeout 60 adb logcat -d -b main,system,crash,events -v time > "$out/logcat-boot.txt" 2>&1 || true
adb logcat -c || true
# Diagnostics only: stream the whole system log to a file as it happens, so the last lines before an emulator
# crash are kept even when "adb logcat -d" can no longer reach the emulator.
adb logcat -v epoch -b main,system,crash,events > "$out/logcat-stream.txt" 2>&1 &
logcat_stream=$!
# Diagnostics only: what the runner knows when the emulator vanished ("device offline").
emu_gone_report(){  # $1 = file to write
  { echo "adb get-state: $(timeout 10 adb get-state 2>&1)"
    pgrep -fa 'qemu-system|emulator64|/emulator ' | cut -c1-200 || echo "The emulator program is no longer running (it crashed or was stopped)."
    free -m
    echo "--- kernel log (last 80 lines):"; sudo -n dmesg -T 2>&1 | tail -80
    echo "--- /tmp/android-runner:"; ls -laR /tmp/android-runner 2>/dev/null | head -80
  } > "$1" 2>&1
  cat "$1"
}
if [[ "$mode" == "main" ]]; then
# Test setup only: time limits so a dead emulator ("device offline") ends the step instead of hanging the job.
status=0
APP_URL="http://localhost:$port/witnessing-app/" OUT="$out" timeout 40m node tests/run-android.js || status=$?
# Diagnostics only: if the emulator vanished ("device offline"), record whether its program is still running,
# the runner's memory, and any crash or out-of-memory lines from the runner's kernel log.
emu_gone=0
if [[ "$(timeout 10 adb get-state 2>/dev/null)" != "device" ]]; then
  emu_gone=1
  emu_gone_report "$out/emulator-gone.txt"
  echo "::warning::The Android emulator stopped responding during the checks (see $out/emulator-gone.txt)."
  # The workflow re-runs everything on a new emulator ONLY if every FAIL of this try is emulator/adb trouble
  # (retry-allowed.txt). If any FAIL is something else (a real check failing), there is no retry (retry-refused.txt).
  node -e '
const fs = require("fs"), out = process.argv[1];
const DEV = /androidDevice\.|Device is closed|device offline|no devices?\b|adb: (device|error)/i;
let r = null; try { r = JSON.parse(fs.readFileSync(out + "/results.json", "utf8")); } catch (e) {}
if (!r) { fs.writeFileSync(out + "/retry-refused.txt", "No retry: this try left no results.json, so it cannot be shown that every failure was emulator trouble.\n"); process.exit(0); }
const fails = r.results.filter(x => x.status === "FAIL"), other = fails.filter(x => !DEV.test(x.detail || ""));
const list = a => a.map(x => "[" + x.step + "] " + x.name + " — " + String(x.detail || "").replace(/\s+/g, " ").slice(0, 200)).join("\n");
if (fails.length && !other.length) fs.writeFileSync(out + "/retry-allowed.txt", "Retry allowed: all " + fails.length + " FAIL row(s) of try 1 are emulator/adb trouble:\n" + list(fails) + "\n");
else fs.writeFileSync(out + "/retry-refused.txt", "No retry: " + (fails.length ? other.length + " of " + fails.length + " FAIL row(s) of try 1 are NOT emulator/adb trouble:\n" + list(other) : "try 1 has no FAIL rows") + "\n");
' "$out" || true
  cat "$out/retry-allowed.txt" "$out/retry-refused.txt" 2>/dev/null || true
fi
# Every counted warning (for example a retried step) also shows as a GitHub warning on the run page.
node -e '
const r = JSON.parse(require("fs").readFileSync(process.argv[1] + "/results.json", "utf8"));
for (const x of r.results.filter(x => x.status === "WARN")) console.log("::warning::Android emulator [" + x.step + "] " + x.name + " — " + x.detail);
' "$out" || true
timeout 60 adb exec-out screencap -p > "$out/last-screen.png" || true
timeout 60 adb logcat -d -s chromium:V cr_*:V AndroidRuntime:E '*:F' > "$out/logcat.txt" 2>&1 || true
# Diagnostics only: the whole system log too (app crashes, low-memory kills, activity changes; made-up test data only).
timeout 60 adb logcat -d -b main,system,crash,events -v time > "$out/logcat-full.txt" 2>&1 || true

fi  # end of main mode

if [[ "$mode" == "negative" ]]; then
status=0; emu_gone=0
if [[ "$(timeout 10 adb get-state 2>/dev/null)" != "device" ]]; then emu_gone=1; emu_gone_report "$out/emulator-gone.txt"; fi
# ---------- Negative check: the app itself crashes the page in step 1 ----------
# A broken copy of the app (tests/negative/mutate.js "crash-page") runs out of memory on purpose right after
# "tap to update". The run MUST fail step 1, with no retry and no warning. If it passes or retries, this job fails.
neg_port="${NEG_PORT:-8932}"; neg_out="$out"; mkdir -p "$neg_out"
if [[ "$neg_port" == "8765" ]]; then echo "::error::Port 8765 is not allowed for this project."; exit 2; fi
neg_ok=0
if [[ "$emu_gone" == 1 ]]; then
  echo "NEGATIVE CHECK COULD NOT RUN: the emulator is gone." | tee "$neg_out/verdict.txt"
elif node tests/negative/mutate.js "${APP_DIR:-app}" /tmp/app-neg-crash crash-page > "$neg_out/build.log" 2>&1; then
  nohup node tests/serve.js /tmp/app-neg-crash "$neg_port" > "$neg_out/server.log" 2>&1 &
  neg_server=$!
  for _ in $(seq 1 30); do curl -fsS -o /dev/null "http://127.0.0.1:$neg_port/witnessing-app/" && break; sleep 1; done
  neg_status=0
  echo "Negative check: running step 1 against a copy of the app that crashes the page (expected to FAIL)"
  GITHUB_STEP_SUMMARY="" STOP_AFTER_STEP1=1 APP_URL="http://localhost:$neg_port/witnessing-app/" OUT="$neg_out" \
    timeout 10m node tests/run-android.js > "$neg_out/run.log" 2>&1 || neg_status=$?
  cat "$neg_out/run.log"
  kill "$neg_server" 2>/dev/null || true
  if [[ "$(timeout 10 adb get-state 2>/dev/null)" != "device" ]]; then emu_gone_report "$neg_out/emulator-gone.txt"; fi
  timeout 60 adb logcat -d -b main,system,crash,events -v time > "$neg_out/logcat-full.txt" 2>&1 || true
  if node -e '
const r = JSON.parse(require("fs").readFileSync(process.argv[1] + "/results.json", "utf8"));
const fail1 = r.results.filter(x => x.step === "1" && x.status === "FAIL");
const retried = r.warnings > 0 || r.results.some(x => / \(try 1\)$/.test(x.name));
const crashNote = r.notes.find(n => /CRASHED|CLOSED/.test(n));
// The failure must come from the page crash, not from the emulator or adb going away.
const deviceTrouble = fail1.some(x => /androidDevice|Device is closed|device offline|no device/i.test(x.detail || ""));
console.log("Negative check: exit " + process.argv[2] + "; step-1 FAIL rows: " + fail1.length + " (" + fail1.map(x => x.name + ": " + x.detail).join(" | ").slice(0, 300) + "); warnings: " + r.warnings + "; retried: " + retried + "; crash seen: " + (crashNote || "NO") + "; emulator/adb trouble: " + deviceTrouble);
// Say exactly why the proof is refused, if it is.
const why = [];
if (process.argv[2] === "0") why.push("the run passed (exit 0), so the crashing copy was not caught");
if (!fail1.length) why.push("step 1 has no FAIL row");
if (retried) why.push("Android re-ran step 1 (" + (r.results.filter(x => / \(try 1\)$/.test(x.name)).map(x => "row \"" + x.name + "\"").join(", ") || "no \"(try 1)\" row") + "; counted warnings: " + r.warnings + "), so the crash proof does not count: an app crash must fail step 1 on the first try, never be retried");
if (!crashNote) why.push("no page crash or page close was seen");
if (deviceTrouble) why.push("a step-1 FAIL came from the emulator or adb going away, not from the page crash");
if (why.length) console.log("Refused: " + why.join("; ") + ".");
process.exit(why.length ? 1 : 0);
' "$neg_out" "$neg_status" | tee "$neg_out/verdict.txt"; [[ "${PIPESTATUS[0]}" == 0 ]]; then
    neg_ok=1
  fi
else
  echo "Negative check: could not build the crashing copy"; cat "$neg_out/build.log"
fi
if [[ "$neg_ok" == 1 ]]; then
  echo "NEGATIVE CHECK PASSED: the page crash made step 1 FAIL, and it was not retried." | tee -a "$neg_out/verdict.txt"
  [[ -n "${GITHUB_STEP_SUMMARY:-}" ]] && echo -e "\n✅ Negative check: a copy of the app that crashes the page FAILS step 1 and is not retried.\n" >> "$GITHUB_STEP_SUMMARY"
else
  if [[ "$emu_gone" == 1 ]]; then echo "::error::NEGATIVE CHECK NOT RUN: the emulator stopped before it could run."
  elif [[ -s "$neg_out/emulator-gone.txt" ]]; then echo "::error::NEGATIVE CHECK NOT SHOWN: the emulator stopped during the negative check, so the page crash was never seen (see $neg_out)."
  else echo "::error::NEGATIVE CHECK FAILED: a copy of the app that crashes the page did not fail step 1 cleanly (see $neg_out)."; fi
  [[ -n "${GITHUB_STEP_SUMMARY:-}" ]] && echo -e "\n❌ Negative check: the crashing copy of the app was not caught as a clean step-1 failure.\n" >> "$GITHUB_STEP_SUMMARY"
  status=1
fi
fi  # end of negative mode

kill "$logcat_stream" 2>/dev/null || true
timeout 30 adb reverse --remove-all || true
exit "$status"
