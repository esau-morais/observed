# Self-observe fixture

Frozen captures of [Request lab](../../../examples/request-lab) that Observed's
own report viewer is observed against.

- `base/` is main at `3f18c7b`, which sends one `GET /api/items` per click.
- `candidate/` is `305f4cd`, where `App.tsx` imports `./duplicate` and sends
  two. Its `request-count` check regresses from 1 to 2.

Both were captured by Observed 0.2.0-alpha.0 on `ubuntu-24.04` in the Observe
workflow's `request-lab` job, run 36334289295 on pull request #42.

The root `observed.json` runs `bun dist/observed.js compare` on these captures
during `setup`, with the build of the revision being observed, and `start`
serves the result with `observed view`. Each self-observation therefore shows
that revision's viewer and comparison code. The fixture only supplies the data.
`setup` fails unless `compare` exits `2`, so a fixture that no longer reads as a
regression stops the run instead of producing a misleading report.

Regenerate it when a capture or evidence schema change makes it unreadable, or
when the evidence the self-observe checks read has changed:

1. From main, change `examples/request-lab/App.tsx` to import `./duplicate`
   and add `duplicate.ts` to `source.paths` in
   `examples/request-lab/observed.json`. Commit.
2. Capture both revisions, either locally with
   `bun run observe examples/request-lab --base main --headless --output <dir>`,
   or by opening a draft pull request and downloading the Observe workflow's
   `observed-bundle` artifact.
3. Replace `base/` and `candidate/` with `captures/journey-1/base` and
   `captures/journey-1/candidate` from `<dir>`, or from `run/` in the artifact.
4. Check that
   `bun run compare tests/fixtures/self-observe/base tests/fixtures/self-observe/candidate --json`
   exits `2`, then update the commits and run above.
