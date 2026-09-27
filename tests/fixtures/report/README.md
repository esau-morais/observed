# Report fixture

`errors-result.json` is the result for trial PR esau-morais/observed-trial-vite-react#12 (branch `s2/anchor-errors`, built with hidden source maps). Its captures come from GitHub Actions run 36329089052, compared again with `bun run compare` from `feat/report-focus`. The candidate throws `TypeError` after the Reading click, so the browser-errors check reports a regression anchored at `src/App.jsx:10` while the screenshots are identical.
