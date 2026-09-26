# Screenshot fixture provenance

These are unmodified `screenshot.png` files from local contributor runs of the
`examples/request-lab` project. Each was captured with agent-browser 0.38.1 in
Chrome 154.0.8037.57 on linux/x64, with a 1120 × 800 viewport at scale 1. The
images show only the example application. They contain no credentials or
private data.

| File | Capture | Finished (UTC) | SHA-256 |
| --- | --- | --- | --- |
| `base.png` | Base, commit `b8b30a36aca4fecd14379d354c853a203d16808b` | 2026-09-26T01:16:17.919Z | `802af4170ebbca4ecb8ccc58e01bce0a26cbd83251e5eecd67af895cb4b7f67c` |
| `duplicate-request.png` | Candidate worktree with `duplicate.ts` as `base.ts` | 2026-09-26T01:16:22.237Z | `76fdc70e3047b7ca9b70286a42e87dbb07c78f611ab2fc59a6b040fa7e2acfd8` |
| `heading-change.png` | Candidate worktree with `visual.ts` as `base.ts` | 2026-09-24T16:07:22.539Z | `daa2bc14e29500eeb53b9ccf8884b2619e885581c49aec35a840fde9dc3d2d94` |

`base.png` and `duplicate-request.png` come from the same comparison run. The
duplicate variant renders the same final UI, but Chromium rasterized a rounded
card corner differently after the extra re-render. Eight pixels near x 855,
y 64 differ, by at most one level in any channel. `heading-change.png` changes
the heading from "Request lab" to "Item collection".

The fixtures test decoding and pixel comparison against real Chromium output.
They do not show that another browser version renders the same pixels.
