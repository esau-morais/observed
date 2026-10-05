# Changelog

Observed follows [semantic versioning](https://semver.org/). Before 1.0.0, a
minor version can change the project configuration, the evidence format, or the
action's inputs.

## 0.2.0-alpha.6 (2026-10-05)

Seventh alpha of 0.2.0, published under the npm dist-tags `alpha` and `latest`.
The action gains the `discord-bot-token`, `discord-channel` and
`discord-images` inputs. The `v0` tag stays on 0.1.0. `result.json` stays at
schema version 9; generated journeys add optional fields.

- **A before-and-after scene.** A comparison journey with recorded steps on
  both sides opens with a scene drawn from its evidence, after Kit Langton's
  PR explainers: the browser, the page, each request route, browser errors
  and the deciding check, a step clock, the failing check in red, and a
  closing code frame at the source line the evidence points at. It opens
  still on the result; Play, Pause, Previous and Next run it, and so do
  Space and the arrow keys.
- **The scene in the comment and Slack.** When a check fails, the comment
  shows the scene as a GIF under the verdict, and `slack-images` posts it in
  the failing thread. It is stored and pruned with the screenshot crops, so
  it needs `contents: write` too.
- **Discord delivery.** With a bot token and a channel ID, failing results go
  to Discord the way they go to Slack, with the screenshot crops attached
  when `discord-images` is on.
- **Generated journeys.** `observed observe --generated <file>` runs up to
  three journeys an agent proposes for files no saved journey reaches. They
  run fixed baseline checks for browser errors, serious accessibility
  violations and server errors, and never change `observed.json`.

## 0.2.0-alpha.5 (2026-10-04)

Sixth alpha of 0.2.0, published under the npm dist-tags `alpha` and `latest`.
The action gains the `comment` and `image-upload-token` inputs, and
`github-token` now also stores screenshot crops, which needs `contents: write`.
The `v0` tag stays on 0.1.0. `result.json` moves to schema version 9, because
paths now start at the repository root: the viewer and the action reject a
version 8 result and ask you to capture both revisions again.

- **One short pull request comment.** Visible without expanding: the verdict,
  the before, after and changed-pixel crops, a table of changed files grouped
  by the evidence that touched them, and the report link. Everything else sits
  in one collapsed block, and files with the same reason share one line. Paths
  start at the repository root and link to the file's diff. `comment: off`
  turns the comment off; the check and job summary still carry the result.
  Slack keeps its message ID in the comment, so without one it posts a new
  message for each failing run.
- **Screenshot crops inline with the workflow token.** With `contents: write`,
  `github-token` commits the crops to a ref under `refs/observed/crops/`,
  outside `refs/heads`, and the comment loads the image from that commit's SHA.
  `slack-images` posts the same crops in place of one region. Later runs delete
  refs older than `retention-days`. The workflow that `observed` writes grants
  the permission. Without it, or on a fork, the
  comment links the crops and a notice says why. `image-upload-token`, a
  user's token, is a fallback. Storing an image never changes the verdict.
- **report.md leads with the conclusion.** The conclusion, the screen
  difference, the checks and unresolved items come first; the rest folds into
  `<details>` blocks.
- **The change map fills the width.** It opens fitted on the directory that
  holds most of the change, uses names in place of paths, and keeps the
  selection in the URL. Enter drills in and Esc goes up. The viewer's
  JavaScript drops from 585 KB to 161 KB gzipped.
- **A view per evidence type.** Screenshots open in a before and after
  comparator with side by side, diff, slider and onion skin modes. React shows
  before and after component trees with render counts, requests show a ledger
  diff, and performance shows every sample with its median and range.

## 0.2.0-alpha.4 (2026-10-03)

Fifth alpha of 0.2.0, published under the npm dist-tags `alpha` and `latest`.
The action's inputs and outputs are unchanged, and its `v0` tag stays on 0.1.0.
`result.json` moves to schema version 8: the viewer and the action reject a
version 7 result and ask you to capture both revisions again.

- **Every changed file gets a relation.** The comparison lists the files that
  differ between base and candidate and says what evidence touched each one:
  checked, exercised, not observed, or outside the captured source. A run whose
  checks pass while a changed file is not observed reads "No regression in the
  named checks" with the count of files not observed, in place of a plain "No
  regression". Slack shows the same count with a neutral icon and lists up to
  5 files not observed.
- **Browser coverage per journey.** Each journey records the source lines that
  ran, as `evidence/coverage.json`, through source maps. It runs the journey
  once more in its own browser session, so the server receives the journey's
  requests again. Turn it off for a journey with
  `{ "kind": "coverage", "enabled": false }` in its `collectors`.
- **Checks are judged by the base revision's `observed.json`.** `observe` reads
  the file from the base revision too, and the base's definition judges every
  check it defines, so a pull request can't loosen a check to pass it. The
  candidate's version of an altered check shows as proposed and sets no
  verdict. The report, the job summary and the PR comment name added, removed
  and altered checks. A changed journey makes its checks unknown, and a removed
  journey with checks makes a run that would otherwise pass unavailable. When
  the base has no `observed.json`, or an invalid one, every check counts as
  added, so a failing check reads "failed", not "regression".
- **The viewer opens on a change map.** Changed files appear with the files they
  import and the files that import them. Each connection names the evidence it
  came from: imports, coverage, errors, checks or requests. A toggle switches to
  the file table.
- **Status words in place of "verified".** Reports, PR comments, job summaries
  and the viewer take their words from one table. The count line reads "N
  checks passed" followed by each count that is not zero. The agent handoff
  lists facts, then next steps, and names the files no journey reached.

## 0.2.0-alpha.3 (2026-09-29)

Fourth alpha of 0.2.0, published under the npm dist-tag `alpha`. The action's
inputs and outputs are unchanged, and its `v0` tag stays on 0.1.0.

- **A failed setup step says which step failed and why.** The capture records
  the step's number, command and exit code, and the last lines of its stderr
  with credentials redacted. It files the failure under the application, not
  the browser tool. A capture that times out during setup names the step.
- **One failure is reported once.** A failed capture no longer adds "Required
  artifact is missing" and "Capture conditions unavailable" lines. When base
  and candidate fail with the same error, the comparison says so in one
  reason, and conclusions read "Both captures failed" or "Every capture
  failed". The verdict stays unavailable.
- **The report leads with the capture failure.** A Capture section quotes each
  distinct failure, links `transcript.jsonl` and `failure.txt`, and lists the
  evidence no capture recorded, in place of empty evidence sections. Repeated
  reasons are grouped by journey and side, and section counts no longer
  overflow the section index.
- **Shorter PR comments on failed captures.** A failure shared by every
  capture is one line, the checks are listed once by verdict, and the check
  and Slack headline read "Unavailable: Every capture failed".

## 0.2.0-alpha.2 (2026-09-28)

Third alpha of 0.2.0, published under the npm dist-tag `alpha`. The action's
inputs and outputs are unchanged, and its `v0` tag stays on 0.1.0.

- **Bare `observed` sets up what is missing.** Run it in your app's directory.
  It checks Bun and the browser, has your coding agent write `observed.json`,
  captures the app and opens the viewer, then offers a pull request that runs
  Observed on every pull request. Without a terminal, or with `--json`, it asks
  nothing, prints the next step and exits `3` when it stopped at a setup step.
  `--yes` answers yes to every question, and `--dry-run` prints the remaining
  steps without changing anything.
- **Your own agent writes `observed.json`.** When the file is missing or
  invalid, `observed` offers to open Claude Code, Codex, OpenCode or `opencode2`
  in its own interactive session with one message that points to
  `observed skill`, and continues when you quit the agent. OpenCode 2 fills in
  the message and waits for Enter. You can also print the message for any other
  agent.
- **`observed skill` and `observed schema`.** The first prints the guide an
  agent follows, with every command running the same version: `observed` when
  that version is installed, and otherwise
  `bunx @observed-software/cli@0.2.0-alpha.2`. The second prints the JSON
  Schema for `observed.json`.
- **The setup pull request works without the GitHub CLI.** One question, yes
  by default. `observed` pushes an `observed/setup` branch with your Git
  credentials. With `gh` signed in, `gh` opens the pull request; otherwise
  `observed` opens GitHub's pull request page with the title and description
  filled in. The workflow is pinned to this
  release's commit, and `.github/dependabot.yml` is added when the default
  branch has none. `observed` links to the ruleset settings and never changes
  them.
- **Every problem in `observed.json` at once.** A rejected `observed.json` now
  lists every issue, in the CLI and in the action, not only the first.

## 0.2.0-alpha.1 (2026-09-28)

Second alpha of 0.2.0, published under the npm dist-tag `alpha`. The action's
`v0` tag stays on 0.1.0; pin the `v0.2.0-alpha.1` commit SHA to try it.

- **No GitHub App needed.** The action posts with the workflow's own token
  through the new `github-token` input, which defaults to `${{ github.token }}`.
  Grant `checks: write` and `pull-requests: write` in the workflow's
  `permissions:`.
- **The job is the check.** The action titles the job's own check run with the
  verdict, and the job passes or fails on the result. It no longer posts a
  separate "Observed" check. Name the job `Observed` and require it. A preview,
  or a run with no named checks, passes with a title that says so.
- **Your own App only signs the comment.** `github-app-client-id` and
  `github-app-private-key` still work. If one of them is empty, the run shows an
  error naming it and posts with the workflow token.
- **Every run says what it posted.** The job summary and the check end with a
  line such as `Posted: check title and comment.` Anything not posted gets an
  annotation with the reason. A refused write names the missing permission, and
  a fork pull request gets a notice that its token is read-only.
- `job-outcome` is deprecated. It has no effect and prints a warning.

## 0.2.0-alpha.0 (2026-09-27)

First alpha of 0.2.0. It is published under the npm dist-tag `alpha`, so
`latest` stays on 0.1.0. Install it with
`bun add --global @observed-software/cli@alpha`. The action's `v0` tag also
stays on 0.1.0; to try the alpha in a workflow, pin the `v0.2.0-alpha.0`
commit SHA.

Captures saved by 0.1.0 are reported unavailable. Capture both revisions again.
`observed.json` files from 0.1.0 still load.

- **More checks and journeys.** A journey can hold several named checks, and a
  project can capture one to three `journeys`. The result carries one verdict
  per check.
- **New evidence and checks.** React renders (`react-renders`), browser timing
  samples with a budget (`performance`), axe accessibility findings
  (`accessibility`), a step timeline with page and console errors
  (`browser-errors`), API operations sent with `fetch` after the browser
  capture (`api-status`, `api-schema`, `api-readback`), and Playwright tests
  run or imported as checks.
- **Source locations.** Findings point at source lines through source maps,
  including hidden maps fetched by URL, or through names that match the
  base..candidate diff. Build capture targets with hidden source maps, such as
  `build: { sourcemap: 'hidden' }` in Vite. A location says where the evidence
  points, not what caused it.
- **Pull requests.** The comment, check run and job summary lead with one
  verdict line with its values, such as "Median LCP 52 ms → 452 ms, at most
  250 ms", then one row per failing or unknown check. They include a prompt for
  your agent. The new input `job-outcome` defaults to `check`: once the GitHub
  App has posted the Observed check, the job passes and the check carries the
  result, so require the check rather than the job. Set `job-outcome: result` to
  keep 0.1.0's behavior.
- **Slack.** The message leads with values and the code location, has buttons to
  open the report and the pull request, and replies in its thread when a later
  run recovers. Set `slack-images: true` and give the bot `files:write` to post
  the largest changed screenshot region in the failing message's thread. It is
  off by default.
- **Report page.** It opens on the evidence behind the verdict. A section rail
  shows each section's status and count, passing sections stay collapsed, and
  steps carry their errors and requests. It has a dark theme, "Copy for agent"
  and "Copy JSON", and embeds the result as
  `<script type="application/json" id="observed-result">`.
- When both sides fail a check, the conclusion says a regression is not
  established instead of saying there is no regression.
- The result is schema version 7.

## 0.1.0 (2026-09-26)

First release.

- Install with `bun add --global @observed-software/cli` and run `observed`
  from any directory. Bun 1.4.2 or later is required. `observed setup`
  downloads Chrome.
- `observed observe` captures the app described by `observed.json`, compares it
  with `--base` when given, and opens the report. `--json` prints the result for
  agents instead. Exit codes: `0` completed, `1` unavailable, `2` a named check
  failed or regressed.
- Evidence goes to `.observed/` in the app's directory, which ignores itself in
  Git.
- One optional `request-count` or `text` check per project. Screenshot pixel
  changes are reported and never fail a run by themselves.
- The `esau-morais/observed` GitHub Action runs on pull requests on Linux and
  macOS, links a self-contained report page from the job summary and, with a
  GitHub App, posts a check run and a pull request comment. It can post failing
  results to Slack.
- The package is published from GitHub Actions with npm provenance. It has no
  install scripts.
