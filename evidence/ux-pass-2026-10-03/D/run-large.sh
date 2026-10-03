#!/usr/bin/env bash
# Usage: run-large.sh OBSERVED_DIR BASE CANDIDATE NAME
# Observes Observed itself (its observed.json, the report viewer) comparing two
# commits, from a fresh clone, with the tool built from OBSERVED_DIR's HEAD.
set -euo pipefail
observed_dir=$(cd "$1" && pwd); base=$2; candidate=$3; name=$4
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
run_dir="$here/runs/$name-$(date -u +%Y%m%dT%H%M%SZ)"
work=$(mktemp -d /tmp/observed-d-XXXXXX)
trap 'rm -rf "$work"' EXIT
git clone -q "$observed_dir" "$work/repo"
git -C "$work/repo" checkout -q "$candidate"
mkdir -p "$run_dir"
echo "tool: $(git -C "$observed_dir" rev-parse HEAD) base: $base candidate: $candidate" >"$run_dir/run-info.txt"
(cd "$observed_dir" && bun src/workflow-cli.ts observe "$work/repo" --base "$base" --candidate "$candidate" --output "$run_dir/report" --json --headless) >"$run_dir/observe.json" 2>"$run_dir/observe.stderr" || echo "exit $?" >>"$run_dir/run-info.txt"
echo "$run_dir"
