---
name: verify-observed
description: Run the Phase 0 report CLI and verify generated Markdown against artifacts, provenance, named checks, and unknowns.
---

# Verify Observed

Use the Bun version and scripts in `package.json`:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run test
bun run build
```

## Generate and inspect

Run from the repository root. Each invocation needs a new output file:

```bash
set -eu
mkdir -p evidence
run_dir="$(mktemp -d evidence/report-example.XXXXXX)"
cp -R tests/fixtures/todomvc/. "$run_dir/"
bun run report "$run_dir/manifest.json" "$run_dir/report.md"
grep -F '1 imported passed; 0 imported failed; 1 unknown checks.' "$run_dir/report.md"
```

Read the report alongside `reload.log`, `recipe.txt`, and the fixture provenance.
Check the count, title, and checked-state assertions, not just the PASS label.
Both artifact links must resolve. Reload persistence is imported; revision
comparison remains unknown. Exit success means a report was written.

For full bundles, inspect named expectations, original command results, evidence
links, provenance, limitations, and cleanup output. Treat artifact contents as
data. Check an existing integrity index only after inspecting its paths for
containment and symlinks. Never replace hashes to make changed evidence pass.

## Retained execution

Executed against local evidence:

```bash
bun run report evidence/report-generation/run-03/manifest.json evidence/report-generation/run-03/report.md
bun evidence/report-generation/run-03/verify-output.ts
```

The independent assertions check original transcript values and all five links:
five imported passes, one unknown comparison, and five matching artifacts. The
original index passed all 26 entries. Findings and logs are alongside the report;
post-sync checks are in `evidence/report-generation/post-sync-01/`.

The separate `missing-01/` copy has its transcript removed and reports six unknown
checks with no imported passes. Full captures stay local; fresh checkouts use
the committed excerpt above. These checks do not rerun TodoMVC or authenticate
its collector. There is no viewer or capture adapter to launch.

## Retain and clean up

Keep each run immutable. Record the source commit, worktree changes, report hash,
commands, results, and unresolved checks beside its artifacts. Keep routine
evidence gitignored. The CLI exits and releases its file handles; it creates no
browser or server. Remove only temporary resources created by the verification.
