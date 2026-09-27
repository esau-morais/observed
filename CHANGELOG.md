# Changelog

Observed follows [semantic versioning](https://semver.org/). Before 1.0.0, a
minor version can change the project configuration, the evidence format, or the
action's inputs.

## 0.2.0-alpha.0 (2026-09-27)

First alpha of 0.2.0. It is published under the npm dist-tag `alpha`, so
`latest` stays on 0.1.0. Install it with
`bun add --global @observed-software/cli@alpha`.

Captures saved by 0.1.0 are reported unavailable. Capture both revisions again.
`observed.json` files from 0.1.0 still load.

- **More checks and journeys.** A journey can hold several named checks, and a
  project can capture one to three `journeys`. The result carries one verdict
  per check.
- **New evidence and checks.** React renders (`react-renders`), browser timing
  samples with a budget (`performance`), axe accessibility findings
  (`accessibility`), a step timeline with page and console errors
  (`browser-errors`), API operations sent without a browser (`api-status`,
  `api-schema`, `api-readback`), and Playwright tests run or imported as
  checks.
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
  run recovers. With the optional `files:write` scope it attaches the
  pixel-difference crop.
- **Report page.** It opens on the evidence behind the verdict. A section rail
  shows each section's status and count, passing sections stay collapsed, and
  steps carry their errors and requests. It has a dark theme, "Copy for agent"
  and "Copy JSON", and embeds the result as
  `<script type="application/json" id="observed-result">`.
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
