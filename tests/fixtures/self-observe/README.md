# Self-observe fixture

Frozen captures of [Request lab](../../../examples/request-lab) that Observed's
own report viewer is observed against. `captures.tar.gz` holds two capture
directories:

- `base/` is main at `5f8304a`, which sends one `GET /api/items` per click.
- `candidate/` is `864499a`, the merge commit of draft pull request #59, where
  `App.tsx` imports `./duplicate` and sends two. Its `request-count` check
  regresses from 1 to 2.

They are archived because a capture keeps its evidence under `evidence/`, and
Observed leaves any path named `evidence` out of the source copy it captures.

Both were captured on `ubuntu-24.04` in the Observe workflow's `request-lab`
job, run 36487319714 on pull request #59, so they record runner paths rather
than a contributor's.

A capture older than its journey's `maxAgeMs`, 24 hours by default, reads as
stale and unavailable. These captures are frozen on purpose, so pull request
#59 set `"maxAgeMs": 315360000000`, 3650 days, in the request-lab journey. They
read as stale after 2036-09-25 when compared at the current time. The previous
archive used the default and failed self-observe a day after it was made.

The root `observed.json` extracts the archive and calls that revision's
`exportComparison` during `setup`. An Effect test clock sets evaluation time
to the archived candidate's `finishedAt`, `2026-09-28T21:37:52.447Z`.
The timestamp remains visible in the report, but does not change between
self-observe runs. This clock applies only to the fixture export process.
Normal captures and comparisons use the real clock. No evidence, freshness
budget, check, or screenshot mask changes.

`start` serves the result with `observed view`. Each self-observation shows
that revision's built viewer and comparison code. Setup fails unless the
fixture concludes a regression. The export program is inline so the
candidate's setup also works on a base revision that predates this fix.

Regenerate it when a capture or evidence schema change makes it unreadable, or
when the evidence the self-observe checks read has changed:

1. From main, change `examples/request-lab/App.tsx` to import `./duplicate`,
   and in `examples/request-lab/observed.json` add `duplicate.ts` to
   `source.paths` and `"maxAgeMs": 315360000000` to `capture`. Commit on a
   throwaway branch and open a draft pull request. The head's `observed.json`
   applies to both captures.
2. Download the Observe workflow's `observed-bundle` artifact from the
   `request-lab` job. Capturing in CI keeps local paths out of the transcripts.
3. From `run/captures/journey-1` in the artifact, archive both directories
   reproducibly:
   `tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -cf - base candidate | gzip -n -9 > captures.tar.gz`,
   and replace `captures.tar.gz` here.
4. Extract it to a temporary directory and check that
   `bun run compare <tmp>/base <tmp>/candidate --json` exits `2` and concludes
   a regression. Then update the commits, run and expiry date above, and close
   the draft pull request.

The performance budget is on the `load` event, at most 250 ms. On this page
the paint metrics were missing from some samples: across the eight sides of the
first four proof runs, LCP was absent from up to 3 of 5 samples and FCP from up
to 1, which leaves a paint budget unknown. `load` was recorded in every sample,
at 44 to 68 ms.
