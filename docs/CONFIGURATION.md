# Configuration reference

What each check counts, what every capture records, and how the optional
collectors work. The [README](../README.md#write-observedjson) covers writing
`observed.json`. `observed schema` prints every field.

## What every capture records

| Evidence | Detail |
| --- | --- |
| Requests | Method, origin, path and status of each request during `steps` |
| Steps | Each step's target, duration and outcome |
| Errors | Page and console errors, with the step after which each was read |
| Accessibility | The accessibility tree after the last step, and axe-core findings with each failing element's role, name and states |
| Screenshot | The page after `steps` |
| Source maps | The map of each script that an error's stack frame or a React component names |

Limits:

- agent-browser reports errors without times. Observed reads them after every
  step and once after the last snapshot, and shows the interval in which each
  error was reported. Errors after that read are not recorded.
- When a step fails, the capture keeps these records, so the report shows
  which step failed and which errors came before it. A capture that times out
  or is cancelled keeps none.
- agent-browser does not report the status of a request answered by a
  redirect, such as a login POST followed by a 302. Observed records status
  `0` and shows it as not recorded. A request check can't match it by status,
  so check the request the redirect leads to.
- Observed fetches source maps from the app's own origin only: first
  `<script>.map`, then the script's `sourceMappingURL`. A line in a stack frame
  shows where the error was thrown, not what caused it.

A comparison also counts screenshot pixels whose YIQ color difference exceeds
0.1 on pixelmatch's threshold scale, and lists the changed regions.
Pixelmatch's anti-aliasing detection is not implemented, so counts can differ
from pixelmatch. When pixels change, Observed writes `visual-diff.png` beside
`report.md`. A pixel change never fails a run. Screenshots that can't be
decoded make the pixel result unavailable.

## Checks in detail

### browser-errors

Errors from the page load and `capture.ready` are listed and not checked.
`ignore` patterns match the first line of each error only, so a stack frame
can't hide an error. When comparing, a regression is an error on the candidate
whose first line the base didn't have, even if the base had other errors.
Without a usable base, the check still fails on the candidate's errors and
claims no regression.

### accessibility

agent-browser reports impact per rule, so every element of a rule at that
impact counts. Violations already on base don't fail the check. Only the same
selector with the same markup confirms that an element was already failing on
base.

The check is unknown when:

- an element matches only by selector or only by markup
- findings are missing on either side
- agent-browser's list of at most 10 elements per rule leaves an element
  unmatched
- axe-core can't decide a rule at that impact on elements base didn't have

Automated rules catch only some accessibility problems. A passing check
doesn't mean the page is accessible.

### react-renders

The check adds the `{ "kind": "react" }` collector, which you can also list in
`collectors` without a check. After the journey, the collector opens the app
in a second browser with React DevTools enabled, runs `ready` and `steps`
again, and counts each render that commits work.

- Renders that React discards after bailing out are not counted.
- Components that share a name are summed.
- Counting stops once React has committed nothing for half a second after the
  last step. A page that keeps committing for 5 seconds leaves the evidence
  unavailable.
- Nothing from the second browser reaches request checks.
- A failed check counts as a regression only when both versions ran the same
  React version and build.

The check is unknown when no mounted component has that name, when the
recording reached its component limit, and when the page has no React root or
loads a new document during `steps`.

## Other origins

For an app with a separate API or asset host, set `capture.allowedOrigins` to
its HTTP(S) origins, such as `["http://127.0.0.1:4000"]`. Request checks match
the application origin by default. Set the check's `origin` to an allowed
origin to check that service.

## Secrets

A `fill` step's `value` is literal text, exported as written, or an
environment reference such as `{ "env": "LOGIN_PASSWORD" }`.

- Recipes and evidence keep only the variable name.
- Observed reads the variable when the capture runs. A missing or empty
  variable fails the capture.
- The value reaches agent-browser on stdin, not in process arguments.
- Observed removes the value from the transcript and other text evidence,
  including JSON-escaped and URL-encoded copies. It matches whole values only.
  A page that splits, truncates or transforms the value, such as a URL cut at
  `#`, can leave part of it in evidence.
- Screenshots keep whatever the page draws. Fill secrets only into fields that
  mask them, such as password inputs.
- Never write a password as a literal value.

## Playwright tests

Observed can run the app's Playwright tests against each captured revision
and report every test as a named check. Add a collector to the journey:

```json
{ "kind": "playwright", "command": ["npx", "playwright", "test", "--reporter=line,json"] }
```

After the journey's browser work, with the app still running, Observed runs
`command` in the same copy of the app.

| Requirement | Detail |
| --- | --- |
| Environment | `PATH`, `HOME`, `LANG`, `TZ`, `BASE_URL` (the app's origin), `PORT`, `PLAYWRIGHT_JSON_OUTPUT_FILE`, and any variable named in the collector's `environment` list. A named variable that is missing or empty fails the capture |
| Base URL | Point `use.baseURL` at `process.env.BASE_URL`, and skip `webServer` when `BASE_URL` is set |
| Reporter | Turn on the JSON reporter without an `outputFile`. `--reporter=line,json` does that |
| Source | List the test files and the Playwright config in `source.paths` |
| Setup | Install `@playwright/test` and its browsers in `setup`. Tests that record video also need `["npx", "playwright", "install", "ffmpeg"]` |
| Time | The suite counts toward `--timeout` |

Observed doesn't check which URL the tests open. A config that keeps a fixed
`baseURL`, such as a shared staging site, tests that site on both sides and
says nothing about the revisions.

Each test becomes a check whose scope starts with "Imported from Playwright".
Observed reads Playwright's report. It did not run the assertions.

| Playwright reports | Check |
| --- | --- |
| Passed, including a `test.fail()` test that failed | Passed |
| Failed on every attempt | Failed |
| Flaky: failed, then passed on a retry | Unknown |
| Skipped or interrupted | Unknown |
| No tests, an error outside any test, a nonzero exit without a failed test, or no JSON report | One unknown "Playwright tests" check |

When comparing, Observed matches tests by project, file and title.

- A test that passed on base and fails on the candidate is a regression only
  when its test file has the same bytes on both sides. When the file changed,
  the check fails without a regression, because the expectation changed.
  Other files the test imports aren't compared.
- A test only the candidate has passes or fails with no base result. A test
  only base has is unknown on the candidate.
- A different Playwright version on each side makes the captures not
  comparable.

Observed copies each test's attachments, such as `trace.zip`, screenshots,
videos and `error-context.md`, into the evidence and links them from the
report. It shows the command that opens each trace in Playwright's viewer.

Observed conceals the `environment` values and redacts known secret patterns
in the JSON report, error messages and text attachments. It can't rewrite a
zip, so it leaves out any zip that holds an `environment` value. Everything
else is copied byte for byte and keeps whatever the test saw: requests,
cookies and pages. Sign tests in with a disposable account.

### Import Playwright results

To read a Playwright run Observed didn't start, such as a report a CI job
uploaded:

```bash
observed import playwright playwright-report/     # HTML report directory
observed import playwright results.json           # JSON reporter output
```

Observed writes a new directory under `.observed/` with `report.md`,
`import.json`, `evidence/playwright.json` and copies of the attachments. Exit
codes: `0` every test passed, `1` a check is unknown, `2` a test failed. An
import shows one run. It doesn't capture the app or compare revisions.

- Observed copies only files under the report's directory, or under `--root`.
  It never follows a path or symlink outside it.
- A JSON report from another machine names paths that don't exist here, so its
  attachments show as unavailable. Import that run's HTML report.
- The HTML report's data format is internal to Playwright. Observed rejects
  one it can't read.
- Observed keeps a copy of the HTML report's `index.html` without redacting
  it, because its data is compressed inside the page.

## Browser performance

Add `{ "kind": "performance" }` to a journey's `collectors`, or add a
`performance` check, which adds it for you. After the journey's capture,
Observed opens a second browser session without DevTools tracing or React
instrumentation. It runs `warmup` discarded runs (default 1, 1 to 5), then
`samples` runs (default 5, 3 to 20). Each run opens `path`, runs `ready` and
`steps`, and reads LCP, FCP, TTFB, CLS, INP, and the DOMContentLoaded and load
times of the page open at the end.

The runs count toward `--timeout`, and each one repeats whatever the journey
changes on the server.

What the numbers mean:

- They are local samples from one machine, not production percentiles.
- CPU and network are unthrottled, because agent-browser 0.38.1 can't
  throttle them. The browser cache is warm after the warm-up.
- Base samples run before candidate samples, each on its own copy of the app.
  Drift between the two runs is not controlled.
- LCP stops at the first click or key press, and INP covers the interactions
  on the final page. Neither measures a response that arrives after an
  interaction, such as a slow API behind a button.

A `performance` check sets a budget on one metric's median:

```json
{
  "kind": "performance",
  "id": "lcp-budget",
  "name": "Largest contentful paint",
  "scope": "Open the shelf page through the Reading click.",
  "metric": "lcp",
  "max": 2500,
  "maxIncreasePercent": 20
}
```

`metric` is `lcp`, `fcp`, `ttfb`, `cls`, `inp`, `dom-content-loaded` or
`load`. `max` is in milliseconds, or unitless for `cls`, and applies to each
side's median. `maxIncreasePercent` compares the candidate median with the
base median. It fails only when the median rises by more than the percentage
and every candidate sample is higher than every base sample.

The check is unknown when:

- the sample ranges overlap under a relative budget
- the run is a preview and the budget is relative
- the two sides ended on different pages
- the base median is 0 and the candidate's is not, which is common for `cls`,
  so give `cls` a `max`
- base samples are missing or not comparable under a relative budget
- a metric is missing from any sample, such as INP on a journey without a
  click or key press

Set `"inspect": true` on the collector to record one DevTools trace run and
one profiler run per side after the samples. Recording slows the page, so
these files never count as samples. A trace is several megabytes.

## API operations

An `api` collector sends HTTP requests to the app without a browser. Observed
sends them with Bun's `fetch` after the journey's browser steps and
screenshot, to the copy of the app it started for that capture. State the app
keeps in that copy, such as a SQLite file or memory, starts fresh on each
side. A database outside the copy carries over from one capture to the next.

The journey itself still needs Chrome. For an API-only journey, point `path`
at a cheap page such as a health check and leave `steps` empty.

```json
{
  "name": "Record a reading over the API",
  "path": "/healthz",
  "ready": [],
  "steps": [],
  "collectors": [
    {
      "kind": "api",
      "operations": [
        { "id": "list-stations", "method": "GET", "path": "/api/stations" },
        {
          "id": "add-reading",
          "method": "POST",
          "path": "/api/stations/north/readings",
          "headers": [
            { "name": "Authorization", "env": "STATIONS_TOKEN", "prefix": "Bearer " }
          ],
          "body": { "json": { "value": 13.4 } }
        },
        { "id": "read-station", "method": "GET", "path": "/api/stations/north" }
      ]
    }
  ]
}
```

| Field | Rule |
| --- | --- |
| Operations | Run once each, in order, up to 20 |
| `path` | Relative to the app's origin. It may carry a query string |
| Header | `{ "name", "value" }` or `{ "name", "env", "prefix" }`. An `env` header reads that variable when the capture runs and sends `prefix` before it. A missing or empty variable fails the capture |
| Credentials | An `env` value never reaches `observed.json`, the recipe or the evidence, and Observed removes it from recorded responses that echo it. A literal credential header, such as `Authorization` with a `value`, makes Observed reject `observed.json` |
| `body` | `{ "json": ... }`, sent as `application/json`, or `{ "text": "..." }`, sent as plain text unless a `Content-Type` header says otherwise |

Observed records each response's status, headers and body.

- It parses the body when `Content-Type` names JSON and keeps other bodies as
  text. It stops reading after 1 MiB and records only the size.
- It doesn't follow redirects, so a 302 is recorded as a 302.
- A request whose response doesn't finish within 10 seconds, or that can't be
  sent, is recorded with the reason.
- Credential-named fields in bodies, such as `token` or `password`, and
  `Set-Cookie` values read `[REDACTED]`. A check that would read a redacted
  value is unknown, and a retyped field under a credential name doesn't show
  as a change.

Three checks read these records. Each names an operation by `id`, and
Observed rejects a check that names one the collector doesn't list.

| Check | Passes when |
| --- | --- |
| `api-status` | The operation answered `status` |
| `api-schema` | The JSON body matches `schema`. A body that isn't JSON fails |
| `api-readback` | `operation` answered 2xx and the later `readback` operation's JSON body holds `expected` at `pointer`, a JSON Pointer such as `/readings/4` |

`api-schema` accepts a JSON Schema subset: `type` (including `integer` and
lists of types), `properties`, `required`, `additionalProperties` as a
boolean, `items`, `enum`, `const` and `anyOf`. It ignores `title`,
`description` and `$schema`. Any other keyword, `$ref` included, makes
Observed reject `observed.json`. So does a schema that names a credential-like
property such as `token`. For a project that describes the response with
Effect Schema, paste the `schema` field of
`Schema.toJsonSchemaDocument(schema)`, and use `Schema.Finite` rather than
`Schema.Number`, which also accepts the strings `"NaN"` and `"Infinity"`.

`api-readback` confirms a side effect. A refused write fails even when the
value was already there. A 2xx write followed by a value that was already
there passes, so read back something only the write creates.

```json
{
  "kind": "api-readback",
  "id": "reading-stored",
  "name": "The new reading is stored",
  "scope": "GET /api/stations/north after the POST.",
  "operation": "add-reading",
  "readback": "read-station",
  "pointer": "/readings/4",
  "expected": 13.4
}
```

A check is unknown when an operation it reads got no response, or when the
body it reads was too large to record.

When comparing, the report lists each operation's status on both sides and
the JSON fields added, removed or retyped, such as
`Removed stations[].average (number)`. Those are observations. Only a check
that passed on base and failed on the candidate is a regression. Fields inside
an array that is empty on either side aren't compared, and a field missing
from some array elements and present in others isn't listed as removed.

## Single steps and saved evidence

`capture`, `compare` and `view` run one step each on saved evidence.
`compare none <capture>` exports a preview and uses the same exit codes as
`observe`. `view` opens a saved bundle as it was evaluated at export, and
rejects evidence whose bytes changed afterward.

From a checkout of this repository, `bun run report <manifest.json>
<new-report.md>` renders a version 1 evidence bundle. The output parent must
exist and the output file must be new. Behavior claims stay labeled imported,
and missing evidence is unknown. Exit success means the report was written.
See the [schema](../src/schema.ts), the
[example manifest](../tests/fixtures/todomvc/manifest.json) and the
[TodoMVC provenance](../tests/fixtures/todomvc/README.md).
