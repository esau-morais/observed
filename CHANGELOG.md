# Changelog

Observed follows [semantic versioning](https://semver.org/). Before 1.0.0, a
minor version can change the project configuration, the evidence format, or the
action's inputs.

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
