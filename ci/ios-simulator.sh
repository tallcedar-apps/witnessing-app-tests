#!/usr/bin/env bash
# Boots an iPhone in the iOS Simulator (macOS runner), opens the app in real Mobile Safari,
# and saves screenshots. The Simulator shares the Mac's network, so localhost is the local test server.
# Usage: bash ci/ios-simulator.sh boot|open|shutdown   (boot starts it; open waits for it, then opens Safari)
# Env: APP_PORT (default 8931), OUT (default results/ios-simulator)
set -euo pipefail
port="${APP_PORT:-8931}"
out="${OUT:-results/ios-simulator}"
url="http://localhost:$port/witnessing-app/"
mkdir -p "$out"
if [[ "$port" == "8765" ]]; then
  echo "::error::Port 8765 is not allowed for this project."
  exit 2
fi
pick_iphone() {
  # Newest available iPhone (no Pro Max preference; any iPhone is fine).
  xcrun simctl list devices available -j | python3 -c '
import json, sys
d = json.load(sys.stdin)["devices"]
best = None
for runtime, devs in d.items():
    if "iOS" not in runtime:
        continue
    ver = tuple(int(x) for x in runtime.rsplit("iOS-", 1)[-1].split("-") if x.isdigit())
    for dev in devs:
        if dev.get("isAvailable") and dev["name"].startswith("iPhone"):
            key = (ver, dev["name"])
            if best is None or key > best[0]:
                best = (key, dev["udid"], dev["name"], runtime)
if not best:
    sys.exit("no iPhone simulator available")
print(best[1], best[2].replace(" ", "_"), best[3].rsplit(".", 1)[-1])
'
}
case "${1:-}" in
  boot)
    read -r udid name runtime < <(pick_iphone)
    echo "Booting ${name//_/ } ($runtime), $udid"
    # Start booting and return; "open" waits for the boot to finish (so WebKit tests can run meanwhile).
    xcrun simctl boot "$udid" || true
    if [[ -n "${GITHUB_ENV:-}" ]]; then
      echo "SIM_UDID=$udid" >> "$GITHUB_ENV"
    fi
    echo "${name//_/ } ($runtime)" > "$out/device.txt"
    ;;
  open)
    xcrun simctl bootstatus "${SIM_UDID:-booted}" -b
    xcrun simctl openurl booted "${url}?cb=$(date +%s)"
    sleep 12
    xcrun simctl io booted screenshot "$out/01-safari-opened.png"
    # The section list should be on screen; a second shot after a short wait shows it settled.
    sleep 4
    xcrun simctl io booted screenshot "$out/02-safari-settled.png"
    echo "Saved Simulator screenshots in $out (screenshots only: this step does not check what the page shows)."
    ;;
  shutdown)
    xcrun simctl shutdown all || true
    ;;
  *)
    echo "usage: $0 boot|open|shutdown"
    exit 2
    ;;
esac
