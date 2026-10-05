# Independent gate corpus

The corpus runs the public CLI against disposable Git repositories. Each pair
writes and commits its required result before capture. The checker reads `result.json`,
HAR entries, agent-browser text, errors, accessibility audits, timing samples,
React recordings, application response logs, Playwright reports, raw CDP coverage,
and the saved Markdown report. It imports no Observed code.

## Run

Use the Bun version in `package.json` and install the browser with the existing
setup command. Choose a new directory for every invocation:

```bash
bun install --frozen-lockfile
bun run setup --with-deps
bun run gates evidence/gates-01
bun run gates:missing evidence/gates-01/correct-change/run/report evidence/missing-01
bun run gates:faults evidence/faults-01
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
Before capture, `required-hashes.json` pins the expectation, checker and tool
provenance bytes. React and Playwright fixtures install their locked dependencies
with Bun; Playwright also installs its pinned Chromium. Its test template becomes
a committed test file before either snapshot, so both sides retain its source hash.
Setup or Git errors stop the run with a nonzero exit before the summary is
written. A failed assertion or unreadable artifact makes the checker exit 1. Capture directories
are retained, including failed runs. The missing-evidence runner commits its expectations in the output directory
before modifying copies of a completed pair.

The checker tests run in `bun run test` and CI. Browser pairs currently run
locally through `bun run gates`; CI execution of the full corpus is pending.

### Seeded source faults

`gates:faults` requires a clean committed checkout, installed dependencies, and
GNU `timeout`. Commit required results in `fault-cases.ts` before running it.
The command first runs the unmutated corpus, missing-evidence probes, and two
mixed-journey probes on that commit. It then clones the commit into disposable
directories and changes exactly one comparator or collector expression per copy.
The original source and checker stay unchanged. Copies reuse installed dependencies
and remain outside the shipped build.

The availability probes combine a passing journey with another whose base is
failed or absent. They call the comparator on copied real captures; the failed
case edits capture metadata and does not reproduce an application startup failure.
Request probes rerun browser capture through the CLI. Their raw HAR must still
contain one base request and two candidate requests.

Each fault directory retains `required.json`, `mutation.diff`, command output,
corpus output, and `checked.json`. Detection requires exactly the committed
semantic failures; unreadable artifacts, extra failures, and process crashes
cannot count as detection. The root `summary.json` records completed results.
Only `complete: true` with `passed: true` establishes the bounded fault set.
An interrupted run can leave no summary or an incomplete one. Commands time out
after 15 minutes, with a 10-second termination grace period.

## Pairs and limits

| Gate | Runnable pairs | What the checker reads | Remaining work |
| --- | --- | --- | --- |
| 1 | `correct-change` | Exit 0, passing checks, HAR count 1 on each side, exercised `app.ts` | Check changed-line mapping against raw coverage |
| 2 | Eight [fault pairs](#seeded-evidence-kinds) and `observation-change` | Regression and exit 2 for each fault, measurements against raw output; changed observations keep two passing checks and exit 0 | One bounded fault per check-capable kind, not every check option. Corpus CI and independent visual inspection remain pending |
| 3 | `outside-error-saved`, `outside-error-generated`, `outside-data-saved`, `outside-data-generated` | Saved summary passes while the changed line does not run; generated line execution matches innermost raw CDP ranges; browser errors 0 → 1 regress with exit 2; text $120.00 → $12.00 is an observation with exit 0; revision and proposal identities | Authored proposals test execution, not a model's ability to discover journeys. CI execution remains pending |
| 4 | `failed-base`, `deleted-artifact`, `old-schema`, `unsupported-evidence-version`, `stale-capture-and-window`, `unknown-collector-kind`, `stale-revision-identity`, `startup-failure` | Exit 1, unavailable comparison, unknown missing evidence, exact failure reasons, candidate HAR; real startup log and process exit; preserved selection hash rejects an older revision | The identity pair covers saved-report revalidation, not GitHub event freshness. The age pair asserts both age and interval errors; it does not isolate age detection |
| 5 | `relaxed-check`, `removed-check`, `rewritten-journey`, `removed-journey` | Raw HAR counts, protected/proposed expectation text and saved Markdown, both changed step definitions; removed journey retains two unknown checks alongside two passing checks | A pair that changes `source`, `setup` or `start`; corpus CI |
| 6 | `intentional-copy` | Reported visual-change status, passing checks, exit 0, unchanged HAR count | Independently inspect screenshot difference |
| 7 | `outside-source` | Only README.md changed, outside-captured-source relation, unchanged HAR; saved report says no captured file changed, lists README.md, and limits checks to their scopes | Wording assertions cover the Markdown report; other delivery surfaces are not checked by this pair |
| 8 | `passing-above-unavailable`, `unavailable-as-passing`, `regression-as-passed`, `collector-drops-requests` | Each source mutation makes the corpus red; both availability faults fail with missing and failed bases. Unmutated corpus passes on the same commit; raw HAR corroborates the request faults | These four known faults are covered, not arbitrary comparator or collector defects. Checker corruption tests are separate safeguards |

A green corpus summary does not mean every release gate holds. The table names
the parts these pairs do not cover.
Gates 9 and 10 need people and have no automated pass. Their session kits
are in [GATE-KITS.md](GATE-KITS.md).

Gate 2 distinguishes check-capable evidence from observations, following
[the product contract](PRODUCT.md#proving-and-showing). Request counts, text,
accessibility, browser errors, performance, React render counts, API operations
and imported Playwright tests can fail named expectations. Screenshots, timelines
and coverage cannot create a regression; their changed-output pairs must keep
passing checks and exit 0. A changed observation alone never passes a check.

At `1bb17d7`, the local gate 7 pair and a fresh run of
[observed-trial-express#28](https://github.com/esau-morais/observed-trial-express/pull/28)
pass their data and report wording checks. Trial expectations were committed
before capture; a deliberately wrong wording expectation fails with exit 1.
Its literal text assertions require the scope sentence, outside-file count and
path, and the named-check limitation. They reject the claim that checks describe
unchanged behavior when an outside file changed, plus the phrases "verified
change" and "safe to merge". These assertions do not classify arbitrary prose.

The trial repository has the request pair at
[observed-trial-express#20](https://github.com/esau-morais/observed-trial-express/pull/20),
from `trial/gate-corpus-base` to `trial/gate-corpus-request`. Its base commits the
expectation before the candidate changes the request count. Do not merge the
seeded fault. The local fixture needs no credentials, framework, or package
installation.

## Altered expectations

At `932b010`, all four gate 5 pairs pass locally and on published refs in
[trial #40](https://github.com/esau-morais/observed-trial-express/pull/40)
(relaxed check),
[#41](https://github.com/esau-morais/observed-trial-express/pull/41)
(removed check),
[#42](https://github.com/esau-morais/observed-trial-express/pull/42)
(rewritten journey) and
[#43](https://github.com/esau-morais/observed-trial-express/pull/43)
(removed journey). Expectations and both source identities were committed before
capture. A deliberately wrong protected expectation makes the checker exit 1.

The first two pairs retain a regression and exit 2 under the base's one-request
expectation; raw HAR contains one base request and two candidate requests. The
relaxed proposal expects two and passes without replacing that verdict. Saved
Markdown shows the base expectation and the proposal separately. Rewritten
steps leave both checks unknown and show the base and proposed step definitions.
The removed journey has no capture: its two checks stay unknown while the
retained journey's two checks pass. Both journey changes exit 1.

These are local CLI runs of published trial refs, not GitHub workflow delivery
checks. No rendered output changed in this corpus update. Changes to `source`,
`setup` or `start` remain uncovered, as does CI execution of these pairs.

## Seeded evidence kinds

The fault pairs and fresh captures of their published trial refs pass. A wrong
accessibility count, committed before capture, fails the independent checker.
The React counter in the main browser runs separately from the DevTools recorder.
The load budget uses three local samples after one warmup; it is not a production
percentile. API coverage here is the status check, not schema or readback behavior.

| Pair | Raw evidence | Trial |
| --- | --- | --- |
| `request-fault` | HAR count 1 → 2 | [#20](https://github.com/esau-morais/observed-trial-express/pull/20) |
| `text-fault` | Element text `Items loaded` → `Wrong items` | [#39](https://github.com/esau-morais/observed-trial-express/pull/39) |
| `accessibility-fault` | One new axe `label` violation on `#item-name` | [#32](https://github.com/esau-morais/observed-trial-express/pull/32) |
| `browser-errors-fault` | Page errors 0 → 1, no console messages | [#33](https://github.com/esau-morais/observed-trial-express/pull/33) |
| `performance-fault` | Each raw load sample, median and 1000 ms budget | [#35](https://github.com/esau-morais/observed-trial-express/pull/35) |
| `react-renders-fault` | App updates 1 → 2, corroborated by a layout-effect counter including the mount | [#36](https://github.com/esau-morais/observed-trial-express/pull/36) |
| `api-status-fault` | Application response log agrees with status 200 → 503 | [#34](https://github.com/esau-morais/observed-trial-express/pull/34) |
| `playwright-fault` | Raw attempt status passed → failed; unchanged test source in both snapshots | [#38](https://github.com/esau-morais/observed-trial-express/pull/38) |
| `observation-change` | Different PNG bytes, final tree matching the raw snapshot, raw paint calls 1 → 2 | [#37](https://github.com/esau-morais/observed-trial-express/pull/37) |

The PNG reader checks the signature and byte difference, not decoded pixels or
visual meaning. Gate 6's independent screenshot inspection remains separate.
These trial reruns use the CLI on published refs; they are not delivery-workflow
or PR-comment checks. No rendered product output changed in this corpus addition.

## Generated journey pairs

The gate 3 fixture retains the browser source, source maps and proposals from
trial PRs [#17](https://github.com/esau-morais/observed-trial-express/pull/17)
and [#18](https://github.com/esau-morais/observed-trial-express/pull/18).
A Bun server serves those same files locally. The saved journey reads only the
summary; each generated proposal clicks the action containing the fault.
Run one with `bun run gates evidence/generated-01 outside-error-generated`.

At `979f990`, all four local pairs and fresh runs of both original trial PRs in
both modes met expectations committed before capture. A deliberately wrong
regression expectation for the saved-only error run failed with checker exit 1.
The source maps remain not observed. The checker reads the innermost CDP range
at line 2, column 2 of both revisions, requires the protected handler boundary,
and rejects absent or ambiguous ranges. Outer script execution cannot replace
missing handler coverage.
It also checks the generated journey's change-map connection. An error can
make the file's relation checked through a stack frame; that relation alone
does not establish execution coverage.

## Missing evidence

Run the startup pair with `bun run gates evidence/startup-01 startup-failure`;
the other seven probes run through `gates:missing`.

The startup pair requires a real base process to exit before readiness. Its
base checks are unknown and the comparison is unavailable with exit 1. Candidate
checks still report their own measured outcomes; a candidate pass does not
establish a passing comparison against missing base evidence. Expectations must
read both dimensions.

The unknown-collector probe replaces a copied text evidence entry with an
unsupported kind. It must retain the unsupported reason, unknown base text check,
and unavailable conclusion. The stale-revision probe substitutes the older base
capture for the selected candidate in a copied report without changing selection
hashes. It invokes the saved viewer's revalidation boundary and maps that result
to the documented conclusion exit code. This is a saved-report identity check,
not a new `compare` CLI option or a GitHub event freshness check.
