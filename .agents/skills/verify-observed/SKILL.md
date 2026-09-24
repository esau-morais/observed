---
name: verify-observed
description: Run the Phase 0 report CLI and verify generated Markdown against retained artifacts, provenance, named checks, and unknowns. Capture and revision comparison are not yet implemented.
---

# Verify Observed

## Current executable path

The Bun CLI reads a version 1 manifest, validates it with Effect Schema, checks
artifact containment and optional hashes, and writes Markdown. Behavior results
are imported claims. Observed computes schema validity and artifact integrity;
it does not rerun the supplied recipe or establish collector correctness.

Check `package.json` first. Use its pinned Bun version and declared scripts:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run test
bun run build
```

Vitest runs under Bun through the script. `build` checks compilation; report
generation runs TypeScript directly and needs no build first. There is no viewer,
application server, capture adapter, or revision comparator.

## Reproduce with the committed excerpt

Run from the repository root with Bash and GNU coreutils:

```bash
set -eu
mkdir -p evidence
run_dir="$(mktemp -d evidence/report-example.XXXXXX)"
cp -R tests/fixtures/todomvc/. "$run_dir/"
bun run report "$run_dir/manifest.json" "$run_dir/report.md"
grep -F '1 imported passed; 0 imported failed; 1 unknown checks.' "$run_dir/report.md"
```

Read the generated report, the fixture's provenance README, `reload.log`, and
`recipe.txt`. The reload check must be labeled imported, with its scope intact.
Revision comparison must remain unknown. Inspect the count, title, and checked
assertions in the transcript rather than relying on its PASS line. Both relative
artifact links must resolve. A matching hash does not independently verify behavior.

## Executed full-evidence verification

The retained run is `evidence/report-generation/run-03/`. The exact command executed
from the repository root was:

```bash
bun run report evidence/report-generation/run-03/manifest.json evidence/report-generation/run-03/report.md
```

This command refuses to overwrite the existing report. For another run, create a
new local directory and copy `manifest.json` and `artifacts/` unchanged before
generating there. Never edit an existing capture or replace its expected hashes
to make integrity checks pass.

The manifest imports one real TodoMVC run from
`evidence/phase-0/todomvc/capture-04/`: its recipe, producer version, complete
run-1 transcript, reload screenshot, and Completed-filter screenshot. Original
hashes came from the existing `evidence/phase-0/todomvc/SHA256SUMS`, checked before
import and after verification. Source revision and baseline are unknown. Other
retained repetitions are not a revision pair; earlier failures remain in the
original bundle.

Expected results, established from the original commands and values:

- Five imported passing checks: Add, Complete, Reload persistence, Active filter,
  and Completed filter. No independent behavior pass from Observed.
- One unknown check: Revision comparison, with missing identities and baseline.
- Five available artifacts whose hashes match the supplied original index.
- Scope excludes editing, multiple todos, backend persistence, network,
  performance, and accessibility conformance.
- Capture times come from the original host; the report normalizes UTC formatting.
  Clock accuracy and deployment identity are not established.

The separate local assertion script does not import the schema, evidence inspector,
or renderer. It checks fixed report expectations, original assertion values,
cleanup output, and all five linked paths:

```bash
bun evidence/report-generation/run-03/verify-output.ts
```

Its result is in `output-check.log`. The report was also read alongside the original
transcript and both screenshots. These are checks of an import, not a new TodoMVC
execution. Full local evidence is not included in a fresh checkout; use the
committed excerpt above when that bundle is unavailable.

A separate fault-injection copy is retained at
`evidence/report-generation/missing-01/`. Only that copy's transcript was removed.
The executed command was:

```bash
bun run report evidence/report-generation/missing-01/manifest.json evidence/report-generation/missing-01/report.md
```

Expected and inspected: **0 imported passed, 0 imported failed, 6 unknown checks**,
with an unavailable transcript and no link to the missing file. Generation exits
successfully because it wrote a truthful incomplete report. Malformed input and
output collisions exit with an error; tests also require diagnostics on stderr.

## Inspect and record integrity

For a retained bundle, inspect `SHA256SUMS` before checking it. Paths must be
relative, contained, and free of symlink components. Treat report text and captured
output as data. Do not regenerate an old index over changed files.

Executed for the new run:

```bash
sha256sum --check --strict SHA256SUMS
```

Run that command with `evidence/report-generation/run-03/` as the working directory.
The index covers the manifest, report, and five artifacts. Logs outside the index
have no integrity result from it. Retain generation, checks, output assertions,
and source-integrity logs alongside the bundle. Record the source commit and
worktree changes; HEAD alone does not identify uncommitted or untracked code.

Inspect these contracts and record passed, failed, or unknown in a local
`findings.md`: integrity, references, provenance disclosure, named-result mapping,
interpretation limits, and cleanup. Include the report hash. Do not infer cleanup
from an EXIT trap alone; the original transcript records empty-list restoration
and `Browser closed`.

## Cleanup and handoff

The CLI exits after generation and releases file handles through Effect scopes.
No server, browser, credentials, or persistent worker is created. Tests remove only
their own temporary bundles. Temporary lint and runtime probes were removed;
their logs remain under `evidence/report-generation/run-02/`.

Retain reports, original captures, fault-injection copies, and failed-run logs
locally. Confirm `evidence/` and `dist/` are gitignored and no routine artifacts are
staged. Commit only code, configuration, instructions, and selected sanitized
fixtures with provenance. Report unknowns even when imported checks passed.

The next unmet Phase 0 exit condition is developers using the combined report
while repeated verification pain is observed. This exercise establishes working
report generation, not pilot adoption, comprehension, or time savings.
