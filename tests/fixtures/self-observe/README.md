# Self-observe fixture

Frozen captures of [Request lab](../../../examples/request-lab) that Observed's
own report viewer is observed against. `captures.tar.gz` holds two capture
directories:

- `base/` is main at `3f18c7b`, which sends one `GET /api/items` per click.
- `candidate/` is `305f4cd`, where `App.tsx` imports `./duplicate` and sends
  two. Its `request-count` check regresses from 1 to 2.

They are archived because a capture keeps its evidence under `evidence/`, and
Observed leaves any path named `evidence` out of the source copy it captures.

Both were captured by Observed 0.2.0-alpha.0 on `ubuntu-24.04` in the Observe
workflow's `request-lab` job, run 36334289295 on pull request #42.

The root `observed.json` extracts the archive and runs
`bun dist/observed.js compare` on the captures during `setup`, with the build of the revision being observed, and `start`
serves the result with `observed view`. Each self-observation therefore shows
that revision's viewer and comparison code. The fixture only supplies the data.
`setup` fails unless `compare` exits `2`, a regression or a failed check, so a
fixture that no longer reads that way stops the run instead of producing a
misleading report. The "Regression" headline check tells the two apart.

Regenerate it when a capture or evidence schema change makes it unreadable, or
when the evidence the self-observe checks read has changed:

1. From main, change `examples/request-lab/App.tsx` to import `./duplicate`
   and add `duplicate.ts` to `source.paths` in
   `examples/request-lab/observed.json`. Commit.
2. Capture both revisions, either locally with
   `bun run observe examples/request-lab --base main --headless --output <dir>`,
   or by opening a draft pull request and downloading the Observe workflow's
   `observed-bundle` artifact.
3. From `<dir>/captures/journey-1`, or `run/captures/journey-1` in the
   artifact, archive both directories reproducibly:
   `tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -cf - base candidate | gzip -n -9 > captures.tar.gz`,
   and replace `captures.tar.gz` here.
4. Extract it to a temporary directory and check that
   `bun run compare <tmp>/base <tmp>/candidate --json` exits `2` and concludes
   a regression. Then update
   the commits and run above.
