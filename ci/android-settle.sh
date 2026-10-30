#!/usr/bin/env bash
# Test setup only: wait for the emulator to finish its start-up work before Chrome is used.
# About 60-80 s after boot, Google Play services restarts itself once it has downloaded its settings, and Android
# then shuts down every app using one of its helpers - Chrome included (seen in run 40997384347's system log).
# Waits until: boot is complete, the device has been up >= MIN_UPTIME s (default 100), and the Play services
# process IDs have not changed for STABLE s (default 45). Gives up after CAP s (default 240) with a warning.
# Usage: bash ci/android-settle.sh [label]
set -uo pipefail
label="${1:-before the tests}"
min_up="${MIN_UPTIME:-100}"; stable="${STABLE:-45}"; cap="${CAP:-240}"
start=$(date +%s)
until [[ "$(timeout 10 adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]]; do
  (( $(date +%s) - start >= cap )) && break
  sleep 2
done
last="__none__"; stable_since=$(date +%s); changes=0; result="settled"
while :; do
  now=$(date +%s)
  pids="$(timeout 10 adb shell 'pidof com.google.android.gms.persistent; echo /; pidof com.google.android.gms' 2>/dev/null | tr -d '\r' | tr '\n' ' ' | tr -s ' ')"
  up="$(timeout 10 adb shell cat /proc/uptime 2>/dev/null | tr -d '\r' | cut -d. -f1)"; up="${up:-0}"
  if [[ "$pids" != "$last" ]]; then
    [[ "$last" != "__none__" ]] && { changes=$((changes + 1)); echo "  Play services process IDs changed at device uptime ${up} s: [$last] -> [$pids]"; }
    last="$pids"; stable_since=$now
  fi
  if (( up >= min_up && now - stable_since >= stable )); then break; fi
  if (( now - start >= cap )); then
    result="NOT settled"
    echo "::warning::Android emulator: Google Play services was still restarting after ${cap} s ($label); starting anyway."
    break
  fi
  sleep 5
done
echo "SETTLE WAIT ($label): waited $(( $(date +%s) - start )) s; ${result}; device uptime ${up} s; Play services pids [$last] unchanged for $(( $(date +%s) - stable_since )) s; ${changes} change(s) seen."
