#!/usr/bin/env bash
# Breakage checks: proves the checklist can fail.
# Builds broken copies of the app in a temporary folder, runs the Chromium checklist against each one,
# and expects every run to FAIL. Exits 1 if any broken copy passes (or can't be built).
#
# Usage:  bash ci/negative-checks.sh <app-dir> [case ...]
#   <app-dir>  a folder with the app's index.html and sw.js (for example a clone of the app repo)
#   case       optional; run only these cases (default: all)
# Environment (all optional):
#   EXPECTED_VERSION  the app's real version (default: read from <app-dir>/index.html)
#   OLD_REF           older app version to update from (default: the 0.10 commit)
#   NEG_PORT          first local port to use (default 8941; never 8765)
#   NEG_JOBS          how many cases run at once (default 3)
#   NEG_OUT           where results go (default: results/negative)
#   CHROME_PATH       a Chrome to use instead of Playwright's Chromium
set -euo pipefail

cd "$(dirname "$0")/.."

app=${1:?Usage: bash ci/negative-checks.sh <app-dir> [case ...]}
shift
app=$(cd "$app" && pwd)
if [ ! -f "$app/index.html" ] || [ ! -f "$app/sw.js" ]; then
  echo "No index.html and sw.js in $app" >&2
  exit 64
fi

ALL_CASES=(wrong-version add-imports-nothing any-file-can-replace one-safety-copy no-offline
  replace-skips-safety-copy csp-removed-outside-image count-checksum-check-removed old-not-downloadable
  tour-finish-adds-section tour-escape-finished tour-no-auto-open tour-old-later-message tour-help-button-missing
  tour-answer-not-saved tour-opens-for-updaters tour-no-resume tour-closed-no-message tour-elsewhere-ignored
  backup-help-no-downloads false-update-note)

# The check each broken copy MUST fail (text that has to appear in one of its FAIL lines). A broken copy that fails
# only for some other reason (a crash, a busy port, another check) counts as CAUGHT-WRONG, which is a failure here.
declare -A EXPECT=(
  [wrong-version]='[1] one tap updates: "Updated to version 9.99'
  [add-imports-nothing]='[12] Add: "Kept both versions'
  [any-file-can-replace]='[12] a test-made fixture file: only "Add to my notes" is offered'
  [one-safety-copy]='[14] once 3 safety copies are kept'
  [no-offline]='[4] step finished without a crash  (page.reload: net::ERR_INTERNET_DISCONNECTED'
  [replace-skips-safety-copy]='[13] Restore lists one safety copy "Before a replace"'
  [csp-removed-outside-image]='[all] the app’s Content-Security-Policy is present and exactly as expected'
  [count-checksum-check-removed]='[13b] (a) forged full backup with wrong section count'
  [old-not-downloadable]='[1] the older version (0000000000000000000000000000000000000000) was fetched'
  [tour-finish-adds-section]='finishing the tour leaves notes, backup record and safety copies unchanged'
  [tour-escape-finished]='Escape closes it as skipped (not finished)'
  [tour-no-auto-open]='a brand-new copy: the tour opens by itself on the main screen at "Step 1 of N"'
  [tour-old-later-message]='] ... it says exactly "You can take the tour any time'
  [tour-help-button-missing]='Help starts with a "🧭 Take the tour" button'
  [tour-answer-not-saved]='... after a reload it does not open by itself again'
  [tour-opens-for-updaters]='the tour does not appear for someone who already has notes'
  [tour-no-resume]='the app closed on that step and opened again: the tour picks up at the backup step'
  [tour-closed-no-message]='... and that open says once where the tour is: exactly'
  [tour-elsewhere-ignored]='another window finished the tour: Next here closes it'
  [backup-help-no-downloads]='... Help says "On this phone: each tap saves a backup file with today’s date to your Downloads.'
  [false-update-note]='brand-new copy: the "New version ready" note never appeared'
)
if [ "$#" -gt 0 ]; then cases=("$@"); else cases=("${ALL_CASES[@]}"); fi

version=${EXPECTED_VERSION:-$(grep -m1 -oE 'APP_VERSION = "[0-9]+(\.[0-9]+)+' "$app/index.html" | grep -oE '[0-9]+(\.[0-9]+)+$' || true)}
[ -n "$version" ] || { echo "Couldn't read the app version; set EXPECTED_VERSION." >&2; exit 64; }
old_ref=${OLD_REF:-c0b4cad4d4f93aca04eeef2505a634c5fe35caaa}
port0=${NEG_PORT:-8941}
jobs=${NEG_JOBS:-3}
out=${NEG_OUT:-results/negative}
mkdir -p "$out"
out=$(cd "$out" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

echo "Breakage checks against $app (version $version), ${#cases[@]} case(s)"

run_case() {
  local name=$1 port=$2 exp=$version old=$old_ref dir="$work/$1" log="$out/$1.log" spid rc
  if [ "$port" = 8765 ]; then port=8764; fi
  case "$name" in
    wrong-version) exp=9.99 ;;
    old-not-downloadable) old=0000000000000000000000000000000000000000 ;;
  esac
  local mrc=0
  node tests/negative/mutate.js "$app" "$dir" "$name" > "$log" 2>&1 || mrc=$?
  if [ "$mrc" -eq 3 ]; then
    echo "$name NOT-APPLICABLE" > "$out/$name.result"
    return
  elif [ "$mrc" -ne 0 ]; then
    echo "$name BUILD-FAILED" > "$out/$name.result"
    return
  fi
  node tests/serve.js "$dir" "$port" > "$out/$name.server.log" 2>&1 &
  spid=$!
  # Make sure this case's own server is the one answering (a port already taken by something else must
  # never let a broken copy count as "caught"): it must still be running and serve this case's index.html.
  local up=0 t
  for t in 1 2 3 4 5 6 7 8 9 10; do
    sleep 1
    kill -0 "$spid" 2> /dev/null || break
    if curl -fsS "http://127.0.0.1:$port/witnessing-app/index.html" 2> /dev/null | cmp -s - "$dir/index.html"; then up=1; break; fi
  done
  if [ "$up" -ne 1 ]; then
    echo "SERVER-FAILED: the test server for this case did not start on port $port (see $name.server.log)" >> "$log"
    kill "$spid" 2> /dev/null || true
    echo "$name SERVER-FAILED" > "$out/$name.result"
    return
  fi
  set +e
  ENGINE=chromium EXPECTED_VERSION="$exp" OLD_REF="$old" \
    APP_URL="http://localhost:$port/witnessing-app/" OUT="$out/$name" \
    timeout 900 node tests/run-browser.js >> "$log" 2>&1
  rc=$?
  set -e
  kill "$spid" 2> /dev/null || true
  wait "$spid" 2> /dev/null || true
  if [ "$rc" -eq 0 ]; then
    echo "$name PASSED-BAD" > "$out/$name.result"
  elif [ "$rc" -eq 124 ]; then
    echo "$name TIMED-OUT" > "$out/$name.result"
  else
    echo "$name FAILED-GOOD rc=$rc" > "$out/$name.result"
  fi
}

i=0
for name in "${cases[@]}"; do
  rm -f "$out/$name.result"
  run_case "$name" $((port0 + i)) &
  i=$((i + 1))
  while [ "$(jobs -rp | wc -l)" -ge "$jobs" ]; do sleep 2; done
done
wait

bad=0
skipped=0
printf '\n%-32s %-12s %s\n' "Broken copy" "Result" "The failing check it had to hit (or the first FAIL line)"
for name in "${cases[@]}"; do
  res=$(cut -d' ' -f2 "$out/$name.result" 2> /dev/null || echo MISSING)
  first=$(grep -m1 -E '^\s*(✗|FAIL)' "$out/$name.log" 2> /dev/null | sed -E 's/^\s+//' | cut -c1-100 || true)
  want=${EXPECT[$name]:-}
  hit=""
  if [ -n "$want" ]; then
    hit=$(grep -E '^\s*(✗|FAIL)' "$out/$name.log" 2> /dev/null | grep -m1 -F -- "$want" | sed -E 's/^\s+//' | cut -c1-100 || true)
  fi
  if [ "$res" = FAILED-GOOD ] && [ -z "$want" ]; then res=NO-EXPECTED-CHECK; fi
  if [ "$res" = FAILED-GOOD ] && [ -z "$hit" ]; then
    printf '%-32s %-12s %s\n' "$name" "CAUGHT-WRONG" "expected a FAIL line with: $want; first FAIL was: $first"; bad=1; continue
  fi
  case "$res" in
    FAILED-GOOD) printf '%-32s %-12s %s\n' "$name" "caught" "$hit" ;;
    NOT-APPLICABLE) printf '%-32s %-12s %s\n' "$name" "n/a" "$(tail -n 1 "$out/$name.log")"; skipped=$((skipped + 1)) ;;
    PASSED-BAD) printf '%-32s %-12s %s\n' "$name" "MISSED" "(the checklist passed a broken app)"; bad=1 ;;
    *) printf '%-32s %-12s %s\n' "$name" "$res" "see $out/$name.log"; bad=1 ;;
  esac
done
if [ "$bad" -eq 0 ]; then
  echo "All $(( ${#cases[@]} - skipped )) broken copies that apply to this version were caught by the check each one targets ($skipped not applicable)."
else
  echo "Some broken copies were NOT caught." >&2
fi
exit "$bad"
