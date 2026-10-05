# Gate 9 and 10 kits

[Gates 9 and 10](ROADMAP.md#mvp-release-gates) need people, so no agent run
passes them. This file is what a facilitator uses to run them. A gate's status
in the roadmap changes only after people have run its kit and the facilitator
has filled in the sheets below.

Participants get the material marked for them and nothing else. Recruit people
who have not read this file, because it holds the answers.

## Gate 9: an unfamiliar project

A person with their own coding agent sets up Observed on a project that the
maintainers did not write, from the README alone, and gets a first report. The
gate needs three projects, at least one not built with React.

### Before the session

- The participant picks a web application they can run locally. It can be
  their own or a public repository, as long as no Observed maintainer wrote it.
- Their machine runs Linux x64 or macOS, with Git, the project's own toolchain
  and their coding agent installed. Bun, the Observed CLI and its browser are
  part of the session, because the README covers them.
- Check that the project builds and starts on that machine at the commit they
  will use. A project that does not build is not a stall in Observed.
- Send nothing about Observed ahead of the session.

### What the participant hears

Read this aloud and paste it into the chat:

> Set up Observed on this project. Use only the README at
> https://github.com/esau-morais/observed#readme and your own coding agent.
> Stop when Observed shows you a report of your app. Please think aloud. I
> can't answer questions about Observed. If something outside Observed blocks
> you, such as your network or the project's own build, tell me.

### Without help

These are the participant's own looking and do not count as help: the README
and the pages it links, anything Observed prints or writes (`observed skill`,
`--help`, error messages, transcripts), their agent, the project's own docs,
and a web search.

A hint from the facilitator or anyone else who knows Observed is help, whether
it names a command, a setting or a page. One hint makes that project "with
help". Write down the hint and its time, then let the session continue so the
rest of the timeline is still recorded.

Fixing a problem unrelated to Observed, such as the network, disk space or a
project dependency that fails to install outside Observed, is not help. Record
its minutes as excluded time.

### First report

A first report is a run of `observed` or `observed observe` that finishes a
capture of the participant's app and opens it in the viewer, with the app's
screenshot on the page. The run exits with 0 or 2. A run that exits with 1 or 3
is not a first report, because the capture or setup did not finish.

### Recording sheet

Copy one per project.

| Field | Entry |
| --- | --- |
| Participant, date, facilitator | |
| Machine: operating system and architecture | |
| Agent and model | |
| Project URL and commit; React or not | |
| Start: the time they open the README | |
| Observed installed, browser included | |
| `observed.json` accepted, and who wrote it | |
| First report: time, exit code, report directory | |
| Excluded minutes, with the reason for each | |
| Time to first report: first report minus start minus excluded minutes | |
| Help given: "none", or each hint with its time | |
| Pages and commands they used, in order | |

Record a stall when a command fails, when the participant or the agent stops
to look for something the last page or output did not say, or when two minutes
pass without progress.

| Time | What they needed | Where they looked, in order | How it ended | Minutes lost | Change that would have prevented it |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

### After the session

Open an issue for each stall that a README or output change would have
prevented. Gate 9 holds when three projects, at least one not built with React,
reach a first report without help. Record the date, the projects and the
median time to first report in the gate's row in the roadmap, and link the
sheets.

### Agent dry run

On 2026-10-05 a coding agent with no Observed context followed the
participant's path with 0.2.0-alpha.7 on Ubuntu 24.04, on
[mdn/todo-react](https://github.com/mdn/todo-react) at `fb6d245` and
[mdn/todo-vue](https://github.com/mdn/todo-vue) at `160ae30`. Both reached a
first report from `observed skill` alone, in 2.5 and 1.5 minutes after the
agent started. Chrome was already installed, so these times leave out the
browser download.

Both first captures failed because Ubuntu 24.04 blocks Chrome's sandbox, and
the failure said only that a `bun` process exited with code 1. Each agent found
the reason in a transcript and the fix in `observed skill`. Since
[#113](https://github.com/esau-morais/observed/pull/113) the failure quotes
the browser's error and names the setting. The other stalls belonged to
the projects: both Vite configurations set `base` to a public URL, which the
agents overrode on the command line, and `observed schema` printed about 186 KB
for an agent that only needed the step and check shapes.

An agent run says nothing about how people set Observed up. It only removes the
stalls an agent hits before a person meets them.

## Gate 10: reading the result

At least three developers outside the project read reports for gates 3 and 5.
From the change map, each names what was checked and what was not, without
explanation.

### Reports

The packet is six reports from the [gate corpus](GATE-CORPUS.md), shown in this
order under neutral letters, so the pair names do not give answers away:

| Letter | Corpus pair | Gate |
| --- | --- | --- |
| A | `outside-error-saved` | 3 |
| B | `outside-error-generated` | 3 |
| C | `outside-data-generated` | 3 |
| D | `relaxed-check` | 5 |
| E | `removed-check` | 5 |
| F | `rewritten-journey` | 5 |

A seventh report, for a change that removes a journey, joins as G once its
corpus pair exists.

Make the reports on the facilitator's machine before the session, from a
checkout of Observed with dependencies and the browser installed:

```bash
mkdir -p evidence/readers
for pair in outside-error-saved outside-error-generated outside-data-generated \
  relaxed-check removed-check rewritten-journey; do
  bun run gates "evidence/readers/$pair" "$pair"
done
```

Each pair's `summary.json` must show `"passed": true`. Then compare every
report with the key. This prints the result, each changed file's relation and
the checks behind it, and each check's verdict:

```bash
jq -r '.conclusion.kind,
  (.changeScope.files[] | [.path, .relation, (.checks | join(","))] | join(" ") | rtrimstr(" ")),
  (.journeys[].checks[] | "\(.id) \(.verdict)")' \
  evidence/readers/relaxed-check/relaxed-check/run/report/result.json
```

The output must match the "Data" lines of that report's key below. If any line
differs, Observed's output has changed since the key was written. Stop and
rewrite that key from the new `result.json` and raw captures before anyone
reads.

Open each report with `bun run view <pair directory>/<pair>/run/report` and
show the participant only the browser tab.

### What the reader hears

Read this aloud before the first report:

> Each page shows what a tool recorded when it ran two versions of a small web
> app, before a change and after it. For each page, use the map near the top
> and tell me which changed files the tool checked and what checked them, then
> which changed files it did not check. Then tell me whether anything failed.
> Take up to three minutes a page and think aloud. I can't explain the page.

Repeat the second sentence for each report if the reader asks what to do.
Answer nothing else about the page.

### Answer key

The key was written from `result.json` and the raw captures of corpus runs at
`f96f475`, before any reader saw the reports. Request counts come from the HAR
files, errors from the browser's error records, text from agent-browser's
output, and line execution from the coverage records. A reader who follows the
page and still gives a wrong answer has found a problem in the page.

Each report lists what the reader must name, and the wrong answers that point
to a misleading page.

#### A: an error outside the saved journey

The change makes the "Open invoice detail" button throw an error instead of
showing text. The saved journey reads only the invoice summary.

Data:

```text
no-regression
public/gate-3-error.js not-observed
public/gate-3-error.js.map not-observed
summary passed
```

- Checked: no changed file. The one check, "One invoice is ready", passed on
  both versions and reads the summary text only.
- Not checked: `public/gate-3-error.js`. The page loads it, but its changed
  line never ran in the journey. `public/gate-3-error.js.map` was not checked either, because
  nothing runs map files.
- Failed: nothing. The run reports no regression in the named checks.
- Wrong answers to note: the error file was checked or the change verified
  because the run passed; the error was caught.

#### B: the same error, with a generated journey

The same change. A second journey, labeled generated, clicks the button.

Data:

```text
regression
public/gate-3-error.js checked generated-browser-errors
public/gate-3-error.js.map not-observed
summary passed
generated-browser-errors regression
generated-accessibility passed
generated-server-errors passed
```

- Checked: `public/gate-3-error.js`, by "No new browser errors" in the generated
  journey. The error points at line 2 of that file. The base recorded no
  errors and the candidate one. The changed line ran.
- Not checked: `public/gate-3-error.js.map`.
- Failed: "No new browser errors" regressed, 0 errors before and 1 after. The
  other three checks passed.
- Wrong answers to note: the saved summary journey caught the error.

#### C: wrong data outside the saved journey, with a generated journey

The change makes the "Show invoice amount" button show $12.00 instead of
$120.00. A generated journey clicks it.

Data:

```text
no-regression
public/gate-3-data.js exercised
public/gate-3-data.js.map not-observed
summary passed
generated-browser-errors passed
generated-accessibility passed
generated-server-errors passed
```

- Checked: no changed file.
- Not checked: `public/gate-3-data.js` ran in the generated journey, 1 of 1
  changed line, but no check judged what it showed.
  `public/gate-3-data.js.map` was not checked.
- Failed: nothing. The recorded text changed from $120.00 to $12.00, and no
  check covers it.
- Wrong answers to note: the data file was checked because it ran, or because
  the generated journey's checks passed. Spotting the amount change is worth
  recording but is not required.

#### D: a duplicate request, with its check relaxed

The change makes each "Load items" click send two requests instead of one, and
edits `observed.json` so the check expects two.

Data:

```text
regression
app.ts exercised
observed.json outside-captured-source
one-request regression
loaded-text passed
```

- Checked: no changed file is linked to a check. `app.ts` ran, 1 of 1 changed
  line. The request check counted 1 request before and 2 after.
- Not checked: `app.ts`, which ran but no check is tied to it, and
  `observed.json`, which is outside the captured source. The page names its
  edit as a changed check instead.
- Failed: "Each Load items click sends one request" regressed under the base's
  expectation of exactly 1. The candidate's proposed version, exactly 2,
  passed and decides nothing.
- Wrong answers to note: the check passed because the change relaxed it;
  `app.ts` was checked by the request check, which the map does not draw.

#### E: a duplicate request, with its check removed

The same request change. `observed.json` deletes the request check.

Data:

```text
regression
app.ts exercised
observed.json outside-captured-source
loaded-text passed
one-request regression
```

- Checked: no changed file is linked to a check. `app.ts` ran, 1 of 1 changed
  line.
- Not checked: `app.ts` and `observed.json`, as in D.
- Failed: the removed check still ran from the base's definition and
  regressed, 1 request before and 2 after.
- Wrong answers to note: removing the check removed the failure; `app.ts` was
  checked by the request check.

#### F: a rewritten journey

The change keeps one request per click and adds a step to the journey in
`observed.json`.

Data:

```text
unavailable
app.ts exercised
observed.json outside-captured-source
one-request unknown
loaded-text unknown
```

- Checked: nothing. Both checks are unknown, because the journey changed and
  the base's checks cannot apply to it.
- Not checked: `app.ts`, which ran, 1 of 1 changed line, and `observed.json`.
- Failed: nothing failed and nothing passed. The proposed versions of both
  checks passed and decide nothing. The base and candidate both sent 1
  request.
- Wrong answers to note: the run passed because the proposed checks passed or
  the request count stayed at 1.

### Reader sheet

Copy one per reader.

| Field | Entry |
| --- | --- |
| Reader, date, facilitator | |
| Role and years of experience; used Observed before? | |
| Packet commit and the date the key was last compared | |

| Report | Seconds | Named as checked | Named as not checked | Said failed | Right, missed or wrong, per key line | Wrong answers from the key | Where they looked | Quotes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | | | | | | | | |
| B | | | | | | | | |
| C | | | | | | | | |
| D | | | | | | | | |
| E | | | | | | | | |
| F | | | | | | | | |

"Where they looked" names the parts of the page in order, such as the map, a
file's panel, the Files view, Details or a section below the map.

### After the session

Gate 10 holds when at least three readers outside the project name every
checked and not checked item in the key for every report, without
explanation. A wrong answer that the key lists is a finding about the page,
not about the reader. Open an issue for each one, quoting the reader. Record
the date, the number of readers and the result in the gate's row in the
roadmap, and link the sheets.
