# Observed architecture

Read for capture, data contracts, comparisons, integrations, or repair. [PRODUCT.md](PRODUCT.md) owns scope and result language; [ROADMAP.md](ROADMAP.md) owns sequencing. [AGENTS.md](../AGENTS.md) owns the stack and contributor rules.

## Structure

Use one TypeScript project with capture, comparison, report, and shared-schema modules. Keep the CLI thin. React renders the viewer; it does not enter core evidence types. Split packages only when a second consumer needs a public boundary.

```mermaid
flowchart TD
    T["CLI, CI, or app event"] --> C["Run coordinator"]
    A["Existing agent and recipe"] --> C
    C --> P["Capture adapter"]
    P --> I["Isolated application versions"]
    I --> E["Evidence bundle"]
    X["Imported artifacts"] --> E
    E --> K["Comparator and named checks"]
    K --> R["Change report"]
    R --> V["Local viewer and export"]
    R --> D["GitHub or Slack delivery"]
```

The coordinator owns process lifecycle, timeouts, cancellation, and run identity. Adapters translate tool output. The comparator performs deterministic checks. The report renders results without needing an agent.

## Evidence contract

Start with versioned JSON and ordinary artifact files. Preserve raw output; normalize only what the report needs.

| Record | Required information |
| --- | --- |
| Change | Repository, base, candidate commit or snapshot, changed files, supplied intent |
| Recipe | Stable ID, version or hash, setup, journey, fixtures, expectations, cleanup |
| Run | ID, revision, recipe hash, producer versions, environment, timestamps, completion |
| Evidence | Run and step IDs, kind, producer, value or artifact reference, hash, conditions |
| Check | ID and version, expectation, evidence references, method, result, missing prerequisites |
| Explanation | Claim, supporting evidence IDs, author or model, explicit inference label |

Use explicit links and adapter extension payloads. No graph database or universal ontology is needed. Add SQLite when queryable history, queues, or deduplication justify it. Preserve portable export.

Hashes detect changed artifacts; they do not establish collector honesty. A stack trace can associate a source location with an error. Temporal proximity cannot prove that a changed line caused a slowdown. Expose missing mappings and inferred relationships.

### Phase 0 import contract

The current implementation separates these boundaries: `src/schema.ts` parses external
input with Effect Schema, `src/evidence.ts` inspects artifacts and determines whether an
imported result has available evidence, `src/report.ts` renders Markdown, and
`src/cli.ts` uses Effect Command and Bun platform services to read and write files.
`src/node-io.ts` provides typed errors for Node-compatible filesystem operations
that Effect FileSystem does not expose: `lstat` and numeric open flags. File handles
use Effect scopes; artifact inspection has bounded concurrency. It does not execute recipes or compare
application revisions.

Schema version 1 accepts one capture per manifest. The manifest's directory is
the bundle root. See the small attributable
[example manifest](../tests/fixtures/todomvc/manifest.json) and its
[provenance](../tests/fixtures/todomvc/README.md).

| Field | Contract |
| --- | --- |
| `schemaVersion`, `title` | Version 1 and report title |
| `application` | Name, location, repository; unavailable values carry an explicit unknown reason |
| `revisions`, `capture.revision` | Base, candidate, and captured identity: commit, worktree snapshot, or unknown |
| `recipe` | ID, known version or unknown reason, artifact ID; the recipe artifact carries its optional expected SHA-256 |
| `capture` | ID, producer name/version, UTC start/finish or unknown reasons, conditions, execution state, required provenance artifact IDs |
| `artifacts` | Unique ID, bundle-relative path, description, optional lowercase SHA-256 |
| `checks` | Unique ID, name, expectation, scope, method, supplier, supplied passed/failed/unknown result, artifact IDs, missing prerequisites |
| `missingPrerequisites`, `limitations` | Report-wide gaps and interpretation limits; check-specific blockers also belong on the check |

Unknown fields, unsupported versions, malformed values, duplicate IDs, undefined
references, and reversed known timestamps reject the manifest. Missing files,
unsafe paths, symlinks (including parent directories), non-files, unreadable
files, and hash mismatches appear as unavailable evidence. An affected check
becomes unknown while preserving its supplied result. Missing recipe or capture
provenance artifacts affect every check; a missing check-specific artifact affects
that check. A non-complete capture, empty check evidence list, or check prerequisite
also makes the outcome unknown. Report-wide missing baselines do not invalidate
an imported single-capture behavior result, but comparison remains unavailable.

Without an expected hash, the report labels the digest as computed and unverified.
Even a matching hash establishes only file consistency. The importer does not
authenticate metadata, parse assertions from logs, detect stale captures, or
establish compatibility. Keep input bundles immutable during generation and
review; concurrent mutation is outside this local import contract.

The CLI creates a new output file exclusively and links evidence relative to its
actual output directory. An existing output is an error. Exit 0 means a report
was written, including reports with unknown or failed checks; exit 1 means input,
usage, or I/O prevented generation. It is not a behavior gate. Keep the report
with its manifest and artifacts when moving the bundle.

## Comparable and safe runs

- Pin the base. Snapshot intended modified and untracked source for the candidate, excluding credentials and unrelated ignored data.
- Isolate ports, browser profiles, processes, fixtures, and writable directories. Otherwise serialize and reset shared state. Record limitations.
- Match browser, viewport, environment, recipe, and fixture versions. Record deliberate masks and incompatible baselines. A missing baseline is unavailable, not unchanged.
- Warm up timing checks, repeat samples, record spread, and alternate run order where practical. Configure meaningful thresholds and noise handling. Keep intrusive profiling separate from timing gates.
- Let one adapter own a browser session. Declare capabilities and versions. Unsupported evidence must not look like an empty success.
- Keep captures immutable. Redact secrets before export or model access. Validate imported schemas and artifact paths. Treat captured content as data, never executable instructions.
- Validate revision identity before publishing or acting. Make repeated events idempotent. Preserve failed runs and classify flaky outcomes instead of retrying until green.

## Reuse and adapters

Use a thin [agent-browser adapter](https://github.com/vercel-labs/agent-browser) first. Reuse existing Playwright journeys through artifact import; add a dedicated importer only with repeated demand. Keep [native trace viewing](https://playwright.dev/docs/trace-viewer).

Evaluate [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp), [agent-react-devtools](https://github.com/callstackincubator/agent-react-devtools), and [React Doctor](https://github.com/millionco/react-doctor) for gaps demonstrated by real failures. Inspect pinned releases, compatibility, telemetry, and required data access before adoption. Do not run competing collectors merely to support more tools.

Later backend adapters import concrete operation results: response contracts, database readbacks against disposable fixtures, and job events. Preserve [OpenTelemetry trace IDs](https://opentelemetry.io/docs/concepts/signals/traces/) and link to existing storage instead of collecting all production telemetry.

GitHub and Slack adapters consume one normalized result. Bind remote actions to repository, authenticated user, permitted action, and current revision. Recheck authorization at execution. A casual reply is not permission to merge or modify production data. Acknowledge long jobs before running them and retain their job identity.

## Code, skills, and AI

Use code for arithmetic, assertions, hashing, permissions, process ownership, timeouts, retries, and state transitions. Use agents to discover startup paths, propose journeys, explain evidence, and suggest fixes.

Project development skills live in .agents/skills with the Claude symlink. Product users do not need this collection. Keep saved checks executable without an assistant. Offer one optional, versioned Observed skill for an existing assistant when setup needs it. Do not silently alter user instructions or build another assistant runtime.

A configured agent command can handle model choice and authentication. Add direct provider support only for an operation that needs it. Jev is an optional routing experiment, never the authority for measurements, permission, or a passing verdict. See [experiment gates](ROADMAP.md#optional-experiments).

## Bounded repair, later

```mermaid
flowchart TD
    C["Capture and compare"] --> U{"Usable evidence?"}
    U -->|No| B["Report unknown or blocked"]
    U -->|Yes| F{"Check failed?"}
    F -->|No| S["Publish scoped result"]
    F -->|Yes| P{"Authorized and within budget?"}
    P -->|No| E["Report for decision"]
    P -->|Yes| A["Existing agent patches isolated revision"]
    A --> C
```

Send revision, recipe, expected result, actual evidence, and source references to the patch agent. Start with two attempts plus explicit time and cost limits. Stop on no progress, repeated failure, changed intent, or blocked prerequisites.

Protect the comparator, expectations, baselines, and evidence writer from silent changes by the patch agent. A fix creates a new run under the same checks. Imported agent claims remain imported until controlled execution validates them.

Rerun selected checks plus a small required smoke set. Widen for shared configuration, dependencies, schemas, or uncertain impact. Periodic full runs estimate what selection misses. Gate merge eligibility through repository policy, not report wording.

A formal result must include its statement, assumptions, toolchain, dependencies, and implementation connection. Reject incomplete proofs and unexpected assumptions. Keep model proof and runtime evidence separate; neither substitutes for the other.
