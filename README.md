# Observed

Observed compares application behavior using browser evidence, named checks, and
source snapshots. It runs locally without a model or account.

The current capture path uses a controlled React application and one saved
journey: **Load items must send exactly one successful request**. It captures a
baseline, unchanged behavior, a seeded duplicate request, and an intentional
visual change. Connecting another application requires a trusted project recipe
in code; general application setup is not implemented yet.

The Phase 0 developer-adoption gate remains **unverified**. A successful fixture
run does not establish usefulness, comprehension, or time savings for developers.

## Try it

Install Bun **1.4.2**, then run from the checkout:

```bash
bun install --frozen-lockfile
bun run setup
bun run demo
bun run view
```

Open the localhost URL printed by `view`. Press Ctrl+C to stop the viewer.
The demo creates its own manifests, builds the fixture, starts isolated browsers,
captures real requests and screenshots, and closes its servers and browser
sessions. No manifest authoring or contributor skills are required.

`demo` prints the new evidence directory. The viewer defaults to its
duplicate-request report. To inspect another case, pass the printed report path:

```bash
bun run view evidence/demo-<id>/reports/visual
bun run view evidence/demo-<id>/reports/missing-baseline
```

Each run gets a new directory. An explicit `--output` directory must not exist.
Nothing rewrites an earlier capture. `evidence/latest.json` is only a convenience
pointer to the last selected report.

On Linux, Chrome may need system libraries: `bun run setup --with-deps` uses the
producer's documented installer. The saved local-fixture recipe launches Chrome
with `--no-sandbox`, restricts page traffic to loopback, and records its launch
arguments. Producer version: agent-browser **0.38.1**. Browser version and actual
viewport, locale, and timezone are recorded with every complete capture.

## Run each step

| Command | Result |
| --- | --- |
| `bun run app` | Start the baseline application for manual use; prints its URL |
| `bun run app duplicate` | Start the deliberately broken application |
| `bun run capture base` | Capture a new baseline source snapshot |
| `bun run capture duplicate` | Capture the duplicate-request variant |
| `bun run capture visual` | Capture the intentional heading change |
| `bun run compare <base-dir> <candidate-dir>` | Evaluate evidence and export a new report bundle |
| `bun run compare none <candidate-dir>` | Evaluate the candidate's absolute check with no baseline |
| `bun run view [report-dir]` | Recheck and serve the selected report locally |

`capture`, `compare`, and `demo` support `--output <new-directory>` and `--json`.
JSON output uses the same schema-backed result shown to a person. A failed capture
exits nonzero and retains its failed manifest and available diagnostics.
`compare` exits successfully when it writes a report, including a report showing
a regression or unavailable comparison; consumers should inspect its result.

The check counts actual `GET /api/items` requests between the saved click and
completion followed by network idle. The expectation lives outside the candidate
application. The HAR, raw producer output, server request ledger, screenshots,
source files, and hashes remain available for inspection. The source identity is
a hash of the selected entry and sorted source-file hashes, including build and
dependency inputs.

A regression requires a comparable passing baseline followed by a failing
candidate. Screenshot byte changes are observations, not regressions. Missing,
failed, corrupted, stale (older than 24 hours), or incompatible captures make the
affected comparison unavailable. An independently executable candidate check
keeps its separate scope when only the baseline is unavailable.

## Move or share a report

Copy the entire report directory, including `base/`, `candidate/`, and `assets/`.
Its Markdown report and artifact links are relative. On another checkout, run:

```bash
bun run view /path/to/copied-report
```

The local viewer verifies the selected manifest hashes and artifacts at startup
and serves those bytes with the computed result. Restart it to inspect later
disk changes. `report.md` and `result.json` record the export-time result.
Hashes detect changed bytes; they do not authenticate a rewritten bundle.

## Import existing evidence

The version 1 importer remains available for existing integrations. Its behavior
claims stay labeled **imported**; integrity checking does not turn them into
checks executed by Observed. To try the retained TodoMVC excerpt:

```bash
mkdir -p evidence
run_dir="$(mktemp -d evidence/report-example.XXXXXX)"
cp -R tests/fixtures/todomvc/. "$run_dir/"
bun run report "$run_dir/manifest.json" "$run_dir/report.md"
```

Expect **1 imported passed, 0 imported failed, and 1 unknown check** from the
[TodoMVC excerpt](tests/fixtures/todomvc/README.md). Revision comparison is unknown.

For your evidence, place a version 1 manifest and artifacts in one directory, then
run `bun run report path/to/manifest.json path/to/new-report.md`. The output parent
must exist and the output file must be new. Missing evidence is reported as unknown.
Exit success means written, not behavior verified. See the
[schema](src/schema.ts) and [example manifest](tests/fixtures/todomvc/manifest.json).
Keep the input bundle immutable during generation and review.

## Development checks

```bash
bun run check
```

Reports and captures stay local under gitignored `evidence/`. Tests use Vitest
under Bun; `bun test` is not the project test command.

## Planned integrations

The implemented slice covers local fixture capture, deterministic comparison,
the viewer, portable reports, and version 1 imports. The broader flow below still
includes unimplemented application adapters, delivery, and repair:

```mermaid
flowchart TD
    T["Code change, CI trigger or requested rerun"] --> R["Select recipe and checks; isolate revisions"]
    R --> B["Browser and framework adapters"]
    R --> S["API, database, job and trace adapters"]
    R -. "When relevant" .-> F["Formal check adapters"]
    B --> E["Versioned evidence with provenance"]
    S --> E
    F --> E
    I["Import existing test artifacts"] --> E
    E --> C["Compare behavior and named expectations"]
    C --> V["Interactive report with evidence and suggestions"]
    V --> D["Local viewer, GitHub and Slack"]
    V --> Q{"Check outcome?"}
    Q -->|Passed or expected change| N["Keep the scoped result"]
    Q -->|Unknown or blocked| U["Report limits; request a decision if needed"]
    Q -->|Confirmed failure| G{"Repair authorized and within budget?"}
    G -->|No| U
    G -->|Yes| A["Existing agent patches an isolated revision"]
    A --> J["Independent rerun under protected expectations"]
    J --> R
    U -. "Resolved prerequisite or approved action" .-> R
    V -. "Proposed recipe improvements" .-> L["Evaluate against saved cases and review changes"]
    L -. "Accepted recipe" .-> R
```

Future repair must preserve the named expectations and create a new run. Changed
expectations require separate review.

### Later evidence types

| Evidence | What you can inspect |
| --- | --- |
| Browser and framework | Appearance, interactions, runtime errors, requests, performance, accessibility, component behavior |
| Backend | API contracts, database changes, job events, distributed traces |
| Formal checks, optional | A specified property, its assumptions, checker result, and connection to the implementation |

GitHub and Slack delivery, remote actions, and AI explanations remain unimplemented.
A passing result covers its named checks, not the entire application or permission
to merge.

## Project documents

[Product](docs/PRODUCT.md) · [Architecture](docs/ARCHITECTURE.md) · [Roadmap](docs/ROADMAP.md) · [Design](DESIGN.md) · [Contributor instructions](AGENTS.md)
