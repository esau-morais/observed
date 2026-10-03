#!/usr/bin/env bash
# Usage: run-case.sh OBSERVED_DIR CASE
#   CASE e2         server.ts throws on POST /api/items (journey only sends GET)
#   CASE exercised  the e2 change plus an items.ts edit on a line "Load items" runs
# Copies OBSERVED_DIR's working tree (tracked and untracked, not ignored), or
# the commit named by OBSERVED_REV when set (e.g. OBSERVED_REV=HEAD), to a
# temp dir, installs it, commits examples/request-lab as the base of a fresh
# git repo, leaves the case's change uncommitted, and runs
# `observe <repo> --base HEAD`. The last line printed is the report directory.
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 OBSERVED_DIR e2|exercised" >&2
  exit 64
fi

observed_dir=$(cd "$1" && pwd)
case_name=$2
case "$case_name" in
  e2 | exercised | nested) ;;
  *)
    echo "CASE must be e2, exercised or nested, got: $case_name" >&2
    exit 64
    ;;
esac

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
run_dir="$here/runs/$case_name-$(date -u +%Y%m%dT%H%M%SZ)"
work=$(mktemp -d /tmp/observed-change-map-XXXXXX)
trap 'rm -rf "$work"' EXIT

tool="$work/observed"
app="$work/request-lab"

mkdir -p "$tool"
if [[ -n ${OBSERVED_REV:-} ]]; then
  observed_rev=$(git -C "$observed_dir" rev-parse --verify "$OBSERVED_REV^{commit}")
  git -C "$observed_dir" archive "$observed_rev" | tar -x -C "$tool"
  source_kind=commit
  : >"$work/observed-status.txt"
else
  observed_rev=$(git -C "$observed_dir" rev-parse HEAD)
  git -C "$observed_dir" ls-files -co --exclude-standard -z \
    | rsync -a --from0 --ignore-missing-args --files-from=- \
      "$observed_dir/" "$tool/"
  source_kind=working-tree
  git -C "$observed_dir" status --porcelain >"$work/observed-status.txt"
  git -C "$observed_dir" diff HEAD >"$work/observed-uncommitted.diff"
fi
echo "observed: $observed_dir, $source_kind of $observed_rev" >&2

mkdir -p "$app"
rsync -a "$tool/examples/request-lab/" "$app/"
if [[ $case_name == nested ]]; then
  # A file in a subdirectory that items.ts imports and the journey runs.
  mkdir -p "$app/lib"
  printf '%s\n' 'export function itemCount(items: readonly unknown[]): number {' '  return items.length;' '}' >"$app/lib/count.ts"
  sed -i "s#^import { Schema } from 'effect';#import { Schema } from 'effect';\nimport { itemCount } from './lib/count';#" "$app/items.ts"
  sed -i "s#  return Schema.decodeUnknownSync(itemsSchema)(body);#  const items = Schema.decodeUnknownSync(itemsSchema)(body);\n\n  return itemCount(items) >= 0 ? items : [];#" "$app/items.ts"
  sed -i 's#      "items.ts",#      "items.ts",\n      "lib/count.ts",#' "$app/observed.json"
fi
git -C "$app" init -q -b main
git -C "$app" -c user.name=observed-change-map -c user.email=change-map@localhost \
  add -A
git -C "$app" -c user.name=observed-change-map -c user.email=change-map@localhost \
  commit -q -m "base: examples/request-lab"

(cd "$tool" && bun install --frozen-lockfile >"$work/bun-install.log" 2>&1) || {
  cat "$work/bun-install.log" >&2
  exit 1
}

apply_e2() {
  git -C "$app" apply --whitespace=nowarn - <<'EOF'
diff --git a/server.ts b/server.ts
--- a/server.ts
+++ b/server.ts
@@ -8,6 +8,10 @@ Bun.serve({
   async fetch(request) {
     const pathname = new URL(request.url).pathname;

+    if (pathname === '/api/items' && request.method === 'POST') {
+      throw new Error('seeded fault outside the saved journey');
+    }
+
     if (pathname === '/api/items') {
       console.log(JSON.stringify({ method: request.method, path: pathname }));

EOF
}

apply_items() {
  git -C "$app" apply --whitespace=nowarn - <<'EOF'
diff --git a/items.ts b/items.ts
--- a/items.ts
+++ b/items.ts
@@ -22,5 +22,7 @@ export async function requestItems(): Promise<readonly Item[]> {
     throw new Error(`GET /api/items returned ${String(response.status)}`);
   }

-  return Schema.decodeUnknownSync(itemsSchema)(body);
+  const items = Schema.decodeUnknownSync(itemsSchema)(body);
+
+  return items;
 }
EOF
}

apply_e2
if [[ $case_name == exercised ]]; then
  apply_items
fi
if [[ $case_name == nested ]]; then
  printf '%s\n' 'export function itemCount(items: readonly unknown[]): number {' '  const count = items.length;' '' '  return count;' '}' >"$app/lib/count.ts"
fi
git -C "$app" diff HEAD >"$work/candidate.diff"

echo "running observe ($case_name) into $run_dir" >&2
started=$(date +%s.%N)
set +e
bun "$tool/src/workflow-cli.ts" observe "$app" --base HEAD --json \
  --output "$run_dir" >"$work/observe.json" 2>"$work/observe.stderr"
status=$?
set -e
finished=$(date +%s.%N)
seconds=$(echo "$finished - $started" | bc)

mkdir -p "$run_dir"
cp "$work/observe.json" "$work/observe.stderr" "$work/candidate.diff" \
  "$work/observed-status.txt" "$run_dir/"
if [[ -f $work/observed-uncommitted.diff ]]; then
  cp "$work/observed-uncommitted.diff" "$run_dir/"
fi
cat >"$run_dir/run-info.json" <<EOF
{
  "case": "$case_name",
  "observedDir": "$observed_dir",
  "observedSource": "$source_kind",
  "observedRevision": "$observed_rev",
  "observedUncommittedChanges": $([[ -s $work/observed-status.txt ]] && echo true || echo false),
  "baseRevision": "$(git -C "$app" rev-parse HEAD)",
  "exitCode": $status,
  "observeSeconds": $seconds
}
EOF

leftover=$(pgrep -af -- "$work" || true)
if [[ -n $leftover ]]; then
  echo "processes still using $work:" >&2
  echo "$leftover" >&2
fi

report="$run_dir/report"
echo "observe exit $status after ${seconds}s" >&2
# Exit 0 is no regression, 2 a failed check; both write a report.
if [[ $status -ne 0 && $status -ne 2 ]] || [[ ! -f $report/result.json ]]; then
  echo "observe did not produce a report; see $run_dir/observe.stderr" >&2
  cat "$work/observe.stderr" >&2
  exit 1
fi

echo "$report"
