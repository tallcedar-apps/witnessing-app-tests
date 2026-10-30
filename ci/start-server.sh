#!/usr/bin/env bash
# Starts the tiny local web server for the checked-out app in the background and waits until it answers.
# Usage: bash ci/start-server.sh <app-folder> [port]    (never port 8765)
set -euo pipefail
app_dir="${1:?app folder}"
port="${2:-8931}"
if [[ "$port" == "8765" ]]; then
  echo "::error::Port 8765 is not allowed for this project."
  exit 2
fi
mkdir -p results
nohup node tests/serve.js "$app_dir" "$port" > results/server.log 2>&1 &
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$port/witnessing-app/"; then
    echo "Local test server is up at http://localhost:$port/witnessing-app/"
    exit 0
  fi
  sleep 1
done
echo "::error::The local test server did not start"
cat results/server.log || true
exit 1
