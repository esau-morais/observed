# Independent gate corpus

The corpus runs the public CLI against disposable Git repositories. Each pair
writes its required result before capture. The checker reads `result.json`,
HAR entries, and agent-browser text output. It imports no Observed code.

## Run

Use the Bun version in `package.json` and install the browser with the existing
setup command. Choose a new directory for every invocation:

```bash
bun install --frozen-lockfile
bun run setup --with-deps
bun run gates evidence/gates-01
bun run gates:missing evidence/gates-01/correct-change/run/report evidence/missing-01
```

To run one pair, append its ID, for example `request-fault`. To check a retained
pair again without running Observed:

```bash
bun run gates:check evidence/gates-01/request-fault/run/report \
  evidence/gates-01/request-fault/expected.json \
  evidence/gates-01/request-fault/exit.json
```

The runner saves each fixture's commits, command output, exit code, raw captures,
exported report, and checker result. `summary.json` lists completed pair results.
Setup or Git errors stop the run with a nonzero exit before the summary is
written. A failed assertion or unreadable artifact makes the checker exit 1. Capture directories
are retained, including failed runs. The missing-evidence runner modifies only
copies of a completed pair.

The four checker tests run in `bun run test` and CI. Browser pairs currently run
locally through `bun run gates`; CI execution of the full corpus is pending.

## Pairs and limits

| Gate | Runnable pairs | What the checker reads | Remaining work |
| --- | --- | --- | --- |
| 1 | `correct-change` | Exit 0, passing checks, HAR count 1 on each side, exercised `app.ts` | Check changed-line mapping against raw coverage |
| 2 | `request-fault`, `text-fault` | Exit 2, regression, exact HAR counts or raw element text on both sides | Accessibility, browser errors, performance, React, API operations, imported Playwright; observation-only kinds need separate expectations |
| 3 | None yet. Generated journeys shipped in #91, and trial PRs [#17](https://github.com/esau-morais/observed-trial-express/pull/17) and [#18](https://github.com/esau-morais/observed-trial-express/pull/18) were captured by hand outside the runner | No readings yet | Add the error pair and the wrong-data pair to the runner; no pass claimed here |
| 4 | `failed-base`, `deleted-artifact`, `old-schema`, `unsupported-evidence-version`, `stale-capture-and-window` | Exit 1, unavailable conclusion, unknown base evidence, exact failure reasons, candidate HAR | Unknown collector kind; stale revision identity; a real base startup failure. The current failed-base pair changes capture metadata. The stale pair asserts both age and interval errors; it does not isolate age detection |
| 5 | `relaxed-check`, `removed-check`, `rewritten-journey` | Base request count 1, candidate 2, protected regression, proposed outcome; altered journey stays unknown | Explicit base/proposed expectation text, removed-journey pair, and a pair that changes `source`, `setup` or `start` |
| 6 | `intentional-copy` | Reported visual-change status, passing checks, exit 0, unchanged HAR count | Independently inspect screenshot difference |
| 7 | `outside-source` | Only README.md changed, outside-captured-source relation, unchanged HAR | Assert rendered wording says no captured file changed |
| 8 | Checker corruption tests only | Forged verdicts, wrong values, wrong exit, missing/malformed raw output, escaping symlink | Seed faults into disposable copies of the comparator and collector |

A green corpus summary does not mean every release gate holds. The table names
the parts these pairs do not cover. Gate 3 needs its two pairs in the runner.
Gates 9 and 10 need people and have no automated pass.

The trial repository has the request pair at
[observed-trial-express#20](https://github.com/esau-morais/observed-trial-express/pull/20),
from `trial/gate-corpus-base` to `trial/gate-corpus-request`. Its base commits the
expectation before the candidate changes the request count. Do not merge the
seeded fault. The local fixture needs no credentials, framework, or package
installation.
