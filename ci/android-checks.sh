#!/usr/bin/env bash
# Runs inside the Android emulator step (reactivecircus/android-emulator-runner).
# Env: APP_PORT (default 8931), EXPECTED_VERSION, OLD_REF, ANDROID_OUT (default results/android),
#      ANDROID_IMAGE (a label for the logs, like google_apis)
# Exit codes: 0 all passed, 1 a check failed, 2 bad setup, 3 Chrome is missing on this system image
# (the workflow then retries once on the google_apis_playstore image).
set -uo pipefail
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
adb logcat -c || true
status=0
APP_URL="http://localhost:$port/witnessing-app/" OUT="$out" node tests/run-android.js || status=$?
adb exec-out screencap -p > "$out/last-screen.png" || true
adb logcat -d -s chromium:V cr_*:V AndroidRuntime:E '*:F' > "$out/logcat.txt" 2>&1 || true
adb reverse --remove-all || true
exit "$status"
