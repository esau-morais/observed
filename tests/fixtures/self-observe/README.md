# Self-observe fixture

Frozen captures of [Request lab](../../../examples/request-lab) that Observed's
own report viewer is observed against. `captures.tar.gz` holds two capture
directories:

- `base/` is main at `5f8304a`, which sends one `GET /api/items` per click.
- `candidate/` is the working tree of `5f8304a` with `App.tsx` importing
  `./duplicate`, which sends two. Its `request-count` check regresses from 1
  to 2.

They are archived because a capture keeps its evidence under `evidence/`, and
Observed leaves any path named `evidence` out of the source copy it captures.

Both were captured by Observed 0.2.0-alpha.1 on Linux x64 with
`bun run observe examples/request-lab --base HEAD --headless`.

A capture older than its journey's `maxAgeMs`, 24 hours by default, reads as
stale and unavailable. These captures are frozen on purpose, so they were taken
with `"maxAgeMs": 315360000000`, ten years, in the request-lab journey. The
first archive used the default and failed self-observe a day after it was
made.

The root `observed.json` extracts the archive and runs
`bun dist/observed.js compare` on the captures during `setup`, with the build of the revision being observed, and `start`
serves the result with `observed view`. Each self-observation therefore shows
that revision's viewer and comparison code. The fixture only supplies the data.
`setup` fails unless `compare` exits `2`, a regression or a failed check, so a
fixture that no longer reads that way stops the run instead of producing a
misleading report. The "Regression" headline check tells the two apart.

Regenerate it when a capture or evidence schema change makes it unreadable, or
when the evidence the self-observe checks read has changed:

1. From main, change `examples/request-lab/App.tsx` to import `./duplicate`,
   and in `examples/request-lab/observed.json` add `duplicate.ts` to
   `source.paths` and `"maxAgeMs": 315360000000` to `capture`. Don't commit
   these changes.
2. Capture both revisions with
   `bun run observe examples/request-lab --base HEAD --headless --output <dir>`.
   `--base` uses the working tree's `observed.json`, so both captures get the
   long `maxAgeMs`.
3. From `<dir>/captures/journey-1`, archive both directories reproducibly:
   `tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -cf - base candidate | gzip -n -9 > captures.tar.gz`,
   and replace `captures.tar.gz` here.
4. Extract it to a temporary directory and check that
   `bun run compare <tmp>/base <tmp>/candidate --json` exits `2` and concludes
   a regression. Then update the commits above, and discard the request-lab
   changes.

The performance budget is on the `load` event, at most 250 ms. On this page
the paint metrics were missing from some samples: across the eight sides of the
first four proof runs, LCP was absent from up to 3 of 5 samples and FCP from up
to 1, which leaves a paint budget unknown. `load` was recorded in every sample,
at 44 to 68 ms.
