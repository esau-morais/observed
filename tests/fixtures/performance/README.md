# Performance fixture provenance

Observed ran `observe --base 4baf4be --candidate 11399ad` on the
[observed-trial-vite-react](https://github.com/esau-morais/observed-trial-vite-react)
branch `s4/slow-handler`, with agent-browser 0.38.1 and Chrome 154.0.8037.57 on
Linux, 5 samples after 1 warm-up run.

- `base.json`: commit 4baf4be, which adds the performance check to
  `observed.json`. Capture eacbcbc4-1588-46ec-b47b-0fb5fa87e998, samples
  2026-09-27 05:08:45–05:09:01 UTC. The capture's `evidence/performance.json`
  had SHA-256
  `a73bec7354aeeb3d51054135c4c16c953c8f008e39447334a7d28eb724d056d6`.
- `slow-document.json`: commit 11399ad, whose one change makes the `/` handler
  in `observed-server.mjs` wait 400 ms. Capture
  491dc8b5-1064-4ced-a81b-09eb883ce348, samples 2026-09-27 05:09:14–05:09:32
  UTC. Evidence SHA-256
  `778be0dc5d38a497540c43fb3afd411668a86c75a3e7f9126f714094b1395fd6`.

Each JSON file is that evidence file's `value`, reformatted by Prettier with no
other change. `raw/base/` and `raw/slow-document/` hold the same captures'
`performance/run-01.json` to `run-06.json`: agent-browser's `eval` output for
each run, byte for byte. The tests rebuild every sample from them. Their LCP
values for the measured runs are 28, 40, 28, 32 and 32 ms before and 440, 428,
428, 432 and 428 ms after.

Independent check: agent-browser's own `vitals` command, run separately against
the same code, reported LCP 20–56 ms before and 420–456 ms after, and a server
wait (`responseStart - requestStart`) of about 400 ms after. The files hold
timings, a loopback origin, document paths, interaction counts and artifact
IDs; no credentials or page content.
