# Accessibility fixture provenance

`a11y.json` is the unchanged output of `agent-browser --json a11y` (agent-browser
0.38.1, axe-core 4.12.1, Chrome headless) against `page.html`, served locally on
2026-09-26. The page seeds a missing form label, two low-contrast paragraphs and
an image without alternative text.

The tests pair it with scoped snapshot lines recorded from the same page with
`agent-browser --json snapshot -s <selector>`. This fixture exercises Observed's
parsing and comparison. It is not a compatibility claim for other
agent-browser or axe-core versions.
