# Playwright fixture provenance

Observed ran `observe --base s6/playwright-base` on
[observed-trial-vite-react](https://github.com/esau-morais/observed-trial-vite-react)
with the working tree at `s6/playwright-failing`, on Linux with
`@playwright/test` 1.58.0 and Google Chrome 145.0.7632.109 (`channel:
'chrome'`). The journey's `playwright` collector ran the trial's own suite in
`e2e/shelves.spec.js`, 5 tests with 1 retry, against the app Observed started.

- Base, commit e555f81, which adds the suite: capture
  aad4880a-6536-4f88-8dbe-e8616b8bfd3f.
- Candidate, commit 78c72b0, whose one change sets `aria-pressed` from the
  shelf label instead of its ID, so the Finished button is never pressed:
  capture eae62e49-63d3-4b1f-a50d-7b0e4b0ea254, started
  2026-09-27T06:04:39Z.

`base.json` and `candidate.json` are each capture's `playwright/report.json`,
Playwright's JSON reporter output after Observed's redaction pass, reformatted
by Prettier with no other change. Their paths start with the capture's
temporary copy of the app, `/tmp/observed-app-t6Eogp` and
`/tmp/observed-app-wSBHQ3`; the tests put the files they need under a new
directory and substitute it for the candidate's.

For this fixture only, the candidate's command also wrote Playwright's HTML
report and copied it out. `html/index.html` holds only that page's
`playwrightReportBase64` script element, byte for byte; the rest of the page is
Playwright's viewer code. `html/data/` keeps three of its attachments, each
named by its SHA-1: the Finished test's first-attempt trace, its screenshot and
its `error-context.md`. The trace is byte-identical to the `trace.zip` the JSON
report names. The videos, the retry's trace and the flaky test's attachments
were left out, so the tests also cover missing files.

Independent check: Playwright's line reporter printed `1 failed` (opens the
Finished shelf), `1 flaky` (keeps the count after a second click), `1 skipped`
and `2 passed` for the candidate, and `1 flaky`, `1 skipped` and `3 passed` for
the base. The same suite run directly with `npx playwright test` against a
build of each branch gave the same counts. The flaky test is seeded: it expects
a different count on its first attempt. Playwright's own `show-trace`, served
with `-h 127.0.0.1`, opened the copied trace and showed the failed
`toHaveAttribute` assertion on `aria-pressed`. The files hold a loopback
origin, temporary paths, test titles, page text from the trial app and a page
screenshot; no credentials.
