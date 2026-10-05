# Saved Playwright assertion

The corpus renames `saved.spec.ts.txt` to `saved.spec.ts` before committing the
fixture's base, then typechecks it with this fixture's pinned dependencies. The template suffix
keeps Vitest from discovering the foreign test suite. Both revisions run the
same assertion, recorded in both source snapshots; only the application marks
the loaded result differently.

The collector supplies `BASE_URL` and `PLAYWRIGHT_JSON_OUTPUT_FILE`. The command
enables the line and JSON reporters without overriding the output file, following
the [Playwright reporter contract](https://playwright.dev/docs/test-reporters#json-reporter)
(checked 2026-10-05). This fixture installs its pinned Chromium through Playwright;
Observed's main browser capture still uses agent-browser.
