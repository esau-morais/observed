# Change map rework: research

Session D, 2026-10-03. Branch `feat/change-map-rework`, rebased on `d46e3b2`.
Status: draft. The decision and prototype sections are filled in after the prototype runs.

The maintainer's words, thread `84ca547e`: "bro wtf is this map. it's ugly these paths + is it going to be small like this? it should at least be a proper section for better visibility and maybe using actually interactive nodes. research first". Later: "if possible, even replicate it", about the _overment repo map.

## What the reference does

Sources: `references/f_01.jpg` to `f_21.jpg`, `scenes/s_01.png` to `s_11.png`, and frames pulled from `v.mp4` (1676x1400, 30 fps, 20.7 s).

Structure, measured from the 1676 px frames:

- Header, about 175 px tall. Title, kind chip, status chip. One plain sentence. A count line: "11 blocks · 22 connections · 6 outside · 10 connections of this block itself: see Details · 2 feature links show on hover". A Connections row of chips, one per type, each with its line sample and a count; zero-count types are dimmed, not hidden. A Blocks row with kind counts and a Status row. A one-line hint: "Arrows point from the user to the used part. Click a block with parts to open it. Esc goes up."
- Canvas, about 1300 px wide. Top level: a top-down layered graph of 11 module cards. Drilled in: a dashed rounded container labeled "Inside Desktop host", a row of dashed OUTSIDE cards under it, then a dashed "Outside: feature blocks" row.
- Cards about 175x78 px. Eyebrow in mono caps (MODULE, FEATURE, OUTSIDE), a status chip at top right, the name in 15 px semibold, then "11 parts" and a chevron when the block has children. Feature cards use a purple-tinted border. Outside cards are dashed and show their kind under the name.
- Edges are curves that run in parallel strands through the gaps between cards, one strand per type, with a numbered badge where several connections share a route. Each type has a color and a dash pattern.
- Right panel, about 375 px. Kind and status chips, name, a mono id, two short paragraphs, SOURCES (paths), PARTS (n) with a status per part, OUTGOING (n) and INCOMING (n). Each connection row is "line sample, type, to/from, target name as a link", then a disclosure line with the reason.

Motion, from frame-by-frame luma and the strips in `/tmp/dref`:

- Hover focus fades in over 3 to 4 frames, about 100 to 130 ms. Unrelated cards and edges drop to roughly 25% opacity. Related edges brighten and draw their count badges.
- Hovering an edge opens a tooltip: "Account session → Runtime, 5 connections: 1 depends-on, 2 calls, 1 implements, 1 writes", one row per connection with its reason.
- Drill-in is a cut. The canvas is blank for one frame, then the child level appears with no zoom or slide. Header and panel switch in the same frame.
- No pan, zoom or drag anywhere in the video. The page scrolls.

## What we have

`references/current-change-map.png` is #76 on a request-lab run where three files changed outside the captured source.

- The map sits in a 700 px column beside a 320 px panel inside the report's body column, so it gets about half the page.
- Blocks are labeled with project-relative paths, so a repo-root file reads `../../DESIGN.md`. Session B's `5147dcf` records `changeScope.outside.projectDirectory` (result schema 9) so paths can start from the repository root.
- The map leads the page even when it has nothing to draw except files outside the captured source.
- Connections draw straight from the bottom center of one block to the top center of the next. ELK's edge routes are computed and thrown away, so edges cross blocks.
- #75's altered checks and removed journeys don't appear on the map.

## Skills used

| Skill | What it contributed |
| --- | --- |
| observed-mode | Decide design questions inside DESIGN.md without asking; verify in a real browser with agent-browser; record platform limits with a source and date. |
| dataviz | Ran its palette validator on the DESIGN.md connection colors. Light: imports `#45595E` and ran-in `#276A6A` are ΔE 5.4 apart for normal vision and 3.2 under deuteranopia, below its floors of 15 and 8. Dark fails the same pair. The dash patterns are the secondary encoding, but the colors alone don't separate. Its interaction rules also apply: hover detail must be reachable by keyboard, hit targets larger than marks, a table view. |
| web-design-guidelines | Fetched the current Vercel list. Applicable: visible `:focus-visible` on every node, `prefers-reduced-motion` for the dim transition, `touch-action: manipulation`, no gesture-only actions, `overscroll-behavior: contain` on the scrolling canvas, `aria-live="polite"` for drill changes. |
| vercel-react-best-practices | `bundle-*`: the single-file report can't lazy-load a chunk, so size has to come off the main bundle. `js-index-maps`: the current canvas calls `map.blocks.find` and `connections.indexOf` inside render loops. `rerender-derived-state-no-effect`: a synchronous layout can be a `useMemo` instead of an effect with a loading state. |
| react-doctor 0.9.14 | Run with a pinned `bunx`, since AGENTS.md rules out npx. Score 72 for the repository. On the map: array-index keys at `change-map.tsx:449` and `:1144`, high complexity in `MapCanvas` and `ChangeScopeView`, a missing index map in `src/change-map.ts:429`. Its installer was not run; it would add npm-based scripts. |
| ui-taste | The map-plus-sidebar pattern, restrained hover (color and opacity, no scale), duration matched to element size. Its shadcn and Tailwind setup does not apply here. |
| typescript-best-practices | For the build: parse at the boundary, discriminated unions for block kinds and selection, no assertions. |
| unslop | Applied to this file. |

Graph and diagram skills from registries: see "Other tools" below once the search finishes.

## Bundle

Measured on 2026-10-03 with `bun build --minify`, React external, gzip -9.

| Library | Version | License | min | gzip |
| --- | --- | --- | --- | --- |
| elkjs (`elk.bundled.js`) | 0.12.0 | EPL-2.0 OR GPL-3.0-or-later | 1,474 KB | 443 KB |
| @dagrejs/dagre | 3.1.1 | MIT | 49 KB | 17 KB |
| @xyflow/react (ReactFlow, Background, Controls) | 12.12.0 | MIT | 184 KB | 60 KB, plus 2.4 KB `base.css` |
| cytoscape | 3.34.3 | MIT | 453 KB | 142 KB |

The viewer was 139 KB gzipped before #76 and 587 KB after (`evidence/change-map/NOTES.md`). elkjs is about 443 KB of that 448 KB growth.

## Layout engines on real data

Real bundle: Observed observing itself from `079773d` to `1198aca`, run by `D/run-large.sh` into `D/runs/large-20261003T143806Z`. The map has 176 blocks (143 files, 18 packages, 3 journeys, 12 routes) and 366 connections; 78 files changed, 55 not observed and 23 outside the captured source.

One drill level at a time, 176x72 px cards, file and directory children only:

| Level | Nodes | Edges | dagre width x height | ELK layered width x height |
| --- | --- | --- | --- | --- |
| src | 42 | 107 | 4492 x 1480 (ranks 4, 9, 7, 4, 3, 2, 5, 1, 3, 1, 2, 1) | 4036 x 1802 |
| src/viewer | 17 | 31 | 1960 x 584 | 1679 x 690 |
| src/capture | 13 | 19 | 1316 x 456 | 1493 x 518 |

Both engines put most of `src` in a few wide ranks, about three viewport widths at 1440 px. ELK's `wrapping.strategy: MULTI_EDGE` with aspect ratio 1.6 changed nothing on these graphs. The reference never shows more than about 12 cards in a level, so it never meets this problem. Our levels can hold 40.

## Map and page constraints

- CSP. `src/report-page.ts:85` allows one hashed script and one hashed stylesheet, with no `unsafe-inline`. React sets styles through the DOM, which CSP allows, so StyleX dynamic styles and React Flow's transforms both work. A library's base CSS would join the one hashed stylesheet at build time.
- Styling. AGENTS.md: StyleX only, no second styling system. React Flow needs `base.css` for its pane, viewport and handle positioning, so adopting it needs a maintainer exception.
- Accessibility. DESIGN.md:292 asks for every block and connection reachable by keyboard in reading order, Enter to open, Escape to go up, and agent text in the inference color with an "Agent description" label.

## Decision

Pending the prototype. Leading option: keep the custom SVG plus HTML button renderer, replace elkjs with a small layered layout of our own that caps a rank's width and wraps it, and route edges through the gaps between cards the way the reference does.
