#!/usr/bin/env bash
# Reads the app version from the checked-out app (APP_VERSION in index.html) and, if an expected
# version was typed in when the run was started, makes sure they match.
# Usage: bash ci/app-version.sh <app-folder> [expected-version]
# Writes "version=0.11" to $GITHUB_OUTPUT when run on GitHub.
set -euo pipefail
app_dir="${1:?app folder}"
expected="${2:-}"
file="$app_dir/index.html"
if [[ ! -f "$file" ]]; then
  echo "::error::No index.html in $app_dir"
  exit 1
fi
found="$(grep -m1 -oE 'APP_VERSION *= *"[0-9]+(\.[0-9]+)+' "$file" | grep -oE '[0-9]+(\.[0-9]+)+' || true)"
if [[ -z "$found" ]]; then
  echo "::error::Could not find APP_VERSION in $file"
  exit 1
fi
echo "The checked-out app says it is version $found"
if [[ -n "$expected" && "$expected" != "$found" ]]; then
  echo "::error::Expected version $expected, but the checked-out app is version $found"
  exit 1
fi
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "version=$found" >> "$GITHUB_OUTPUT"
fi
