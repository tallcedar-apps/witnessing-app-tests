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
  tour-finish-adds-section)
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
  sleep 1
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
printf '\n%-32s %-10s %s\n' "Broken copy" "Result" "First failing check"
for name in "${cases[@]}"; do
  res=$(cut -d' ' -f2 "$out/$name.result" 2> /dev/null || echo MISSING)
  first=$(grep -m1 -E '^\s*(✗|FAIL)' "$out/$name.log" 2> /dev/null | sed -E 's/^\s+//' | cut -c1-90 || true)
  case "$res" in
    FAILED-GOOD) printf '%-32s %-10s %s\n' "$name" "caught" "$first" ;;
    NOT-APPLICABLE) printf '%-32s %-10s %s\n' "$name" "n/a" "$(tail -n 1 "$out/$name.log")"; skipped=$((skipped + 1)) ;;
    PASSED-BAD) printf '%-32s %-10s %s\n' "$name" "MISSED" "(the checklist passed a broken app)"; bad=1 ;;
    *) printf '%-32s %-10s %s\n' "$name" "$res" "see $out/$name.log"; bad=1 ;;
  esac
done
if [ "$bad" -eq 0 ]; then
  echo "All $(( ${#cases[@]} - skipped )) broken copies that apply to this version were caught ($skipped not applicable)."
else
  echo "Some broken copies were NOT caught." >&2
fi
exit "$bad"
