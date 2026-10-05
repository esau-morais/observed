# Observed roadmap

[PRODUCT.md](PRODUCT.md) owns scope, [ARCHITECTURE.md](ARCHITECTURE.md) owns
contracts, and this file owns sequence, status and decisions.

## Status

| Phase | Deliverable and exit condition | State |
| --- | --- | --- |
| 0. Validate | Reports from existing artifacts. Developers use the combined view and repeated verification pain is observed | Built. No developer has used the combined view yet |
| 1. See a real project | One command opens a captured page or a version comparison. Two separate applications, one non-React, use the same runner without core edits. Checks distinguish failed expectations from visual changes, and missing requested captures stay visible | Complete |
| 2. Repeatable use | Executed recipes, isolated runs, one CI trigger, export. Fresh-checkout runs need no recurring setup help, and stale or failed captures never pass | Complete. An agent set up an unfamiliar app from the README. No person has |
| 3. Extensions | Several checks and journeys, React renders, browser timing, accessibility, browser errors, API operations, Playwright import. The plan was one extension chosen from pilot demand | Shipped in #26 to #33, before any pilot |
| 3a. MVP | Change scope drawn as a change map and a repository map, protected expectations, generated journeys, agent descriptions, replay, the writing rules, and the independent gate corpus, in the [order below](#phase-3a-order). Every [MVP release gate](#mvp-release-gates) holds | In progress. Built: change scope, browser coverage, protected expectations for journeys and checks (not fields outside the journeys), the change map, generated journeys run locally, and the writing rules. Not built: the repository map, agent descriptions, replay. Gates 3 and 8 have no runnable pair |
| 4. Verification harness | `observed loop`, Stop hooks and `observed mcp` around the user's own agent, in the [order below](#phase-4-order). Observed runs the change, judges it by the base's expectations, reruns it and decides when a loop stops. The agent owns the model loop. Each stop condition holds on the gate corpus, and the loop improves on handing the evidence to the user's agent | Starts once gates 1 to 8 hold |
| Later | Database, jobs, traces, more frameworks, proof adapters, each tied to a recurring workflow | Not started |

Phase 3a comes first because Observed runs saved journeys on base and
candidate, and nothing related those journeys to the files a pull request
changed. Two probes
on the Request lab example at `ad28490` showed the cost. A fault seeded outside
the saved journey read "No regression". A duplicate request shipped with its
expectation raised from 1 to 2 also read "No regression".

Line delivery and posting modes, the two unshipped parts of the 2026-09-27
delivery refresh, follow the MVP gates, and so do
[more delivery platforms](#delivery-platforms). Working code does not establish that
people find Observed useful, so the pilot stays a separate step.

### Phase 3a order

1. Change scope data
2. Browser coverage
3. Protected expectations
4. The change map with its table
5. Generated journeys
6. The repository map and agent descriptions
7. Replay

Items 1 to 5 are built. On 2026-10-05 the order of the remaining work
became: runnable pairs for every gate an agent can pass, then the gate 9 and
10 kits, then item 6, then replay. See [what waits](#what-waits).

Gate 7 needs item 1, gate 1 needs items 1 and 2, gate 5 needs item 3, gate 3
needs items 1, 2 and 5, and gate 10 needs items 1 to 5. Generated journeys
need items 1 and 2, not item 4, so presentation work does not hold back gates
3, 5 and 7. Each item adds the gate corpus pairs for the gates it serves.

### Phase 4 order

1. `observed loop` with a local agent. It owns the worktree, the report
   directory and the budget, and the scripted pairs drive it
2. Stop hooks for Claude Code and Codex, with the loop's stop table
3. `observed mcp`, so agents call `observe`, `check` and `evidence` during a
   task
4. The loop in CI with a configured agent command. The agent pushes a
   commit, and the pull request's job judges it. Generated journeys run there
   as their own mode

Each item adds gate corpus pairs driven by a scripted agent command, so the
pairs need no model: an agent that fixes the seeded fault, one that cannot,
one that edits the check, one that points `start` at a stub server, one that
edits an imported test, one that writes `result.json` by hand, one with a
flaky check, one that changes nothing, and a cancelled run. Each must end in
the stop that [ARCHITECTURE.md](ARCHITECTURE.md#verification-harness-phase-4) defines.

## MVP release gates

No release drops the alpha label until every gate holds. Each gate is a base
and candidate pair with an outcome written before the run. Gates 1 to 7 run on
trial repositories. A checker judges them by reading `result.json` and the raw
producer output, without importing the comparator.

| Gate | Pair | Required result | Status and evidence |
| --- | --- | --- | --- |
| 1. Correct change | A change inside a saved journey that keeps its expectation | No regression, exit 0, and the scope lists the changed file as checked or exercised | Local `correct-change` pair passes, including exercised scope. Raw coverage cross-check pending |
| 2. Seeded fault | One fault per shipped evidence kind, inside a saved journey | Regression, values equal to the raw producer output, exit 2 | Local request and text pairs pass against raw output. Other kinds still need pairs |
| 3. Change outside saved journeys | Two faults in captured source that no saved journey exercises: one that raises an error, one that returns wrong data | Without an agent, the scope lists the file as not observed. With one, a generated journey runs the changed lines. A baseline check reports the error. The wrong data is listed as a difference and sets no verdict | Four corpus modes pass at `979f990`, with fresh runs on trial PRs #17 and #18: saved-only not observed; generated error regression/exit 2; wrong data observation/exit 0. Raw CDP, errors, text, identities and proposal targets agree. A wrong expectation fails; CI remains pending |
| 4. Missing evidence | Failed base capture, deleted artifact, stale revision, older schema, unsupported collector | Unavailable or unknown, never a pass, exit 1 | Five copied-capture probes pass. Unknown collector kind, stale revision identity and a real startup failure still need pairs |
| 5. Altered expectations | The change relaxes, removes, or rewrites a check or its journey, or changes how the app is set up or started | The result names each altered check and judges it by the base's expectation, with the proposed version beside it. A changed journey, `source`, `setup` or `start` makes every check in its scope unknown, with both versions shown | Three local pairs pass: relaxed check, removed check, rewritten journey. Remaining cases in the corpus table |
| 6. Intentional change | A visual or copy change with passing checks | An observation, not a regression | Local intentional-copy pair passes; result reports visual change with passing checks |
| 7. No captured change | A change to docs or to files outside `source.paths` | Says no captured file changed, lists the outside files, and claims nothing about the change | Local outside-source pair passes its data checks. Rendered wording assertion pending |
| 8. Observed's own faults | Known faults seeded into copies of the comparator and collector | Unit tests or the gate corpus fail on each fault | Probe at `ad28490` failed for the one fault tried. With "no regression" ranked above "unavailable", all 360 unit tests passed |
| 9. Unfamiliar project | Three projects the maintainers did not write, one non-React, set up by a person with their own agent from the README | A first report without help. Record time and every stall | Not run with people |
| 10. Reading the result | At least three developers outside the project read reports for gates 3 and 5 | From the change map, each names what was checked and what was not, without explanation | Not run |

The counts in gates 9 and 10 are proposals. Those two gates need people, so an
agent can prepare them and cannot pass them. Self-observation runs on every
pull request and decides none of these gates.

The probes behind the status column are kept in the maintainer's checkout
under `evidence/mvp-reconciliation-2026-09-29/`, which Git ignores. The
[gate corpus](GATE-CORPUS.md) adds runnable pairs and lists the remaining checks.
Local results above come from corpus runs at `65d347e`, a commit on the
gate corpus branch before #90 was squashed, so it is on no branch now. They do
not establish all of a gate's requirements.

## What waits

On 2026-10-05 the maintainer asked whether Observed still knew what it was.
Work that week had shipped more ways to show evidence, such as the scene, its
GIF and Discord, while gates 3 and 8 still had no runnable pair. The
[line between proving and showing](PRODUCT.md#proving-and-showing) now decides
order: work that lets a gate hold comes before work that shows more.

| Work | State |
| --- | --- |
| The remaining work for gates 1 to 8 in [GATE-CORPUS.md](GATE-CORPUS.md#pairs-and-limits): gate 3 and 8 pairs first, then gate 7 wording, gate 4 and 2 pairs, gate 5's removed journey and expectation text, gate 1's raw coverage cross-check, gate 6's screenshot inspection, and the corpus in CI | Next |
| Self-observation that differs only when the viewer changed | Next. An identical comment on every pull request proves nothing |
| Rendered diagrams for docs changes | After the gate 3 and 8 pairs. Small and show-only, and it gives gate 7 pull requests something to show |
| Gate 9 and 10 kits | After rendered diagrams. Gate 10 needs items 1 to 5, all built |
| Repository map and agent descriptions | After the kits. No gate needs them |
| Replay | After the repository map, and still in the first release as the maintainer decided on 2026-10-03. The scene already plays the recorded steps, so gate 10 readers can shape what replay adds |
| More scene and GIF work, narration | Waits for a gate 10 reader to need it |
| Phase 4 verification harness | Plan only until gates 1 to 8 hold |
| GitLab, Azure DevOps, posting modes, line delivery | After gates 1 to 8, as already decided |
| Checks on docs, such as links or prose lint | Not Observed's work. The project's own CI runs them |

## Delivery platforms

The maintainer asked on 2026-10-05 for GitLab, Azure DevOps and Discord
delivery next to GitHub and Slack. Each is a delivery adapter as
[ARCHITECTURE.md](ARCHITECTURE.md#delivery-adapters) defines it, with the
platform limits recorded there. No MVP gate needs a new platform.

1. Discord, built now. It needs no gate work and reuses the Slack rules.
2. GitLab merge requests, after gates 1 to 8 hold. A CI/CD component runs the
   CLI on `merge_request_event` and posts one note, with a project access
   token from a masked CI/CD variable. The job's own result is the status.
   Images go through the uploads API.
3. Azure DevOps pull requests, after GitLab. A pipeline template runs under the
   Build validation policy and posts one thread and a pull request status
   with `System.AccessToken`.

Before either host adapter, the GitHub delivery code moves behind one host
interface, and the pull request comment is rendered without GitHub-specific
paths. Each host gets a trial repository and a real run before its first
release, like `observed-trial-express` for GitHub.

## Decisions

| Date | Decision | Basis |
| --- | --- | --- |
| 2026-09-26 | GitHub and Slack delivery come before the pilot, so participants see results where they work | Maintainer |
| 2026-09-27 | Delivery presents Observed as a proof-check, with source locations and an evidence handoff to the user's own agent | Maintainer |
| 2026-09-28 | Setup needs no GitHub App. The action posts with the workflow token and the job's check carries the verdict. Bare `observed` runs the missing setup steps, offers a setup pull request, and opens the person's own agent with `observed skill`. An App setup command, a public App, fork comments through `workflow_run`, and installing the skill wait for pilot demand | Maintainer |
| 2026-09-29 | Keep every shipped evidence kind. The pilot removes kinds nobody uses | They are built and tested |
| 2026-09-29 | The PR line reads "N checks passed", then the change scope | The original line said "affected behaviors". The count never was about the change |
| 2026-09-29 | The agent writes generated journeys for files that are not observed. The report lists what is still not observed afterwards | The stated intent is to avoid manual work. A person decides only what is uncertain, risky, or needs permission |
| 2026-09-29 | Line delivery and posting modes, from the 2026-09-27 delivery refresh, follow the MVP gates | A verdict that says nothing about the change matters more than how it is posted |
| 2026-09-29 | Execution coverage is the basis for "exercised", for the browser and for Node servers. Bun servers stay in scope only if their offsets map to source lines | Probes returned execution counts on all three. See [ARCHITECTURE.md](ARCHITECTURE.md#change-scope) |
| 2026-09-29 | The base's expectation judges an altered check. The candidate's version is shown as proposed. Merging to base accepts it | Visual baselines work this way in [Chromatic](https://www.chromatic.com/docs/test). Observed has no hosted review step, so the merge is the acceptance |
| 2026-09-29 | A pull request that alters a check fails or is unknown on that check. Bypass is repository policy | ARCHITECTURE.md gates merges through repository policy. The pilot counts how often this happens |
| 2026-09-29 | With no captured change, capture anyway and say the checks describe unchanged behavior | The run still detects drift in the environment or a stale fixture |
| 2026-09-29 | Add fast-check as an exact dev dependency with the first property tests, and name it in AGENTS.md in the same change | In a probe with 4.10.2, a property caught the seeded precedence fault that the unit tests missed |
| 2026-09-29 | No proof tool is an MVP requirement or a CI dependency. Lean stays the default for a production proof adapter unless evidence favors another tool for a specific case | See [optional experiments](#optional-experiments) |
| 2026-09-29 | Three developers for gate 10, then the pilot's six to eight | Enough to find wording that misleads before recruiting more |
| 2026-09-29 | Repair starts when gates 1 to 8 hold, without waiting for the pilot | Repair depends on protected expectations and change scope, not on adoption |
| 2026-10-03 | The first release is not limited to the minimum. Phase 3a also ships the change map, the repository map, agent descriptions, and replay. Gate 10 reads the change map, and the other gates stay as written | The maintainer: "we shouldnt limit ourselves just cause its mvp". The reason for a map, that typed connections with detail on demand read faster than a list of files, is the agent's delegated decision. Gate 10 tests it |
| 2026-10-03 | The change map is the main view of a comparison with a change scope. Its side panel opens on the evidence that explains the verdict, and the file table stays as its text version | Gate 10 asks readers to name what was checked and what was not |
| 2026-10-03 | Generated text follows a reduced ASD-STE100: one meaning per status word, 20 words per instruction, 25 per statement, facts apart from instructions. No analogies and no "explain like I'm five" mode | An analogy adds claims the evidence does not make. ASD holds the copyright to the dictionary, so Observed copies only the rules |
| 2026-10-03 | Check names describe the protected behavior, and journeys are named after the user's action. The PR comment leads with the names of failed or unknown checks, then the count line | Plain words for reviewers without a model at run time |
| 2026-10-03 | Agent descriptions are explanation records in the inference color. They never set a chip, a count, or a verdict | Observed separates measurements from interpretation |
| 2026-10-03 | Imports come from `Bun.Transpiler.scan`, resolved with `Bun.resolveSync`, and the viewer lays out the map with elkjs | A probe resolved every import of the Request lab's `App.tsx` with no new parser. elkjs handles nested directories |
| 2026-10-03 | The viewer lays out the map with its own layered layout instead of elkjs, one directory level at a time | elkjs was 443 KB of the 587 KB gzipped viewer. Neither ELK nor dagre caps a row's width, and a level of Observed's own `src` held 42 blocks, about three screens wide. The map opens fitted to the width and adds zoom and pan from there |
| 2026-10-03 | Replay records the session that produced the checked evidence, when ffmpeg is installed. Without ffmpeg the replay is unavailable and nothing else changes. A journey with a timing check records its coverage session, labeled as a separate run | Recording can change timing |
| 2026-10-03 | A check that one side lacks reads "not run" on a complete capture and "unknown" on a capture that did not complete. The viewer's "not configured" label is gone | "Not configured" was outside the documented check values. Missing evidence is unknown, never anything else |
| 2026-10-05 | Discord delivery posts as a bot with a channel ID, like Slack, not through a channel webhook | A webhook cannot reply to a message, so a recovery could not point at the failure it ends. See [Discord's webhook reference](https://docs.discord.com/developers/resources/webhook) |
| 2026-10-05 | Discord attaches the screenshot crops to the message, and each edit replaces them | Discord keeps only the attachments an edit lists, so an edit never shows an earlier run's image beside the current verdict |
| 2026-10-05 | GitLab, then Azure DevOps, follow the MVP gates. The GitHub code moves behind a host interface when GitLab starts | No gate needs them. GitLab needs a paid tier for project access tokens on GitLab.com, and Azure's attachment visibility is undocumented, so both need a trial before a design is final |
| 2026-10-05 | A comparison journey with recorded steps on both sides opens with a scene drawn from its evidence, after Kit Langton's PR explainers. The viewer has it first; the GIF for the comment and Slack follows | [Karpathy's scale](https://x.com/karpathy/status/2105819303471976479), which the maintainer adopted on 2026-10-03, puts explainer videos above text and diagrams. A scene built from result.json needs no model and claims nothing the evidence does not hold |
| 2026-10-05 | The scene ships to the comment and Slack as a GIF that agent-browser screenshots frame by frame and `src/gif.ts` encodes. Remotion and HyperFrames stay out | Remotion bills each organization that renders in CI. HyperFrames adds 141 MB, Node 22 and FFmpeg for formats GitHub cannot show inline from a URL. See [scene export](ARCHITECTURE.md#scene-export) |
| 2026-10-05 | Observed proves with named checks and shows everything else as observations. Only named checks and capture availability set the verdict, counts and exit code. The rule and each surface's limits live in [PRODUCT.md](PRODUCT.md#proving-and-showing), not in a fourth plan file | The maintainer: "it feels like Observed is more like an observation tool and report tool than a proof check". The prove-versus-show line was implied by the writing rules but never stated, so each new view had to argue its own limits |
| 2026-10-05 | A docs change gets each changed `mermaid` diagram rendered from base and candidate, labeled as an observation, with no model or service. Gate 7 still claims nothing about the change | The maintainer's example: an architecture change shows its diagram before and after. The first research chat, on 2026-09-11, already named it: "visual does not necessarily mean recording, but can be sometimes rendering interactive mermaid diagrams". No tool found on 2026-10-05 does this without a model or a hosted service. See [rendered diagrams](ARCHITECTURE.md#rendered-diagrams) |
| 2026-10-05 | Work that lets a gate hold comes before work that shows more. Replay moves after the repository map and stays in the first release | The week's first day shipped the scene, its GIF and Discord before gate 3 and 8 pairs. See [what waits](#what-waits) |
| 2026-10-05 | Narration waits. When built, it is optional, uses a stock or user-supplied voice, never a clone of someone else, and labels an agent-written script as interpretation | A GIF carries no sound, and a video in a comment needs a user's upload. Captions already carry every fact |
| 2026-10-05 | Observed is a verification harness, not an agent harness. It runs the change, records it, judges it by the base revision's expectations, reruns it and decides when a loop stops. Claude Code, Codex, opencode or another agent owns the prompts, tool calls and edits. This rules out a model loop inside Observed, a model provider call from the loop or the hooks, prompts beyond the deterministic handoff, and any result that rests on the agent's word | The maintainer agreed with the direction on 2026-10-05, pending research, and this row and the three below record that research. Playwright MCP, Chrome DevTools MCP and agent-browser already show agents the running app, and Stop-hook plugins and Aider's `--auto-test` already keep an agent going. Storybook's MCP server runs story tests for the agent to fix and rerun, with the tests in the agent's tree ([Storybook MCP](https://storybook.js.org/docs/ai/mcp/overview)). None of these judges runtime evidence by expectations the agent cannot edit, with a rerun the tool owns. [Harbor](https://docs.harborframework.com/tasks/verifier), from the Terminal-Bench team, and [SWE-bench](https://github.com/SWE-bench/SWE-bench/blob/main/swebench/harness/run_evaluation.py) grade this way, after the agent finishes, on benchmark tasks rather than as a loop around a person's change |
| 2026-10-05 | The MCP server offers tools only, over stdio, on protocol revisions 2025-11-25 and 2025-06-18, built on Effect's `McpServer`. Resources, prompts and the Tasks extension wait for client support | opencode documents only tools, Codex documents neither resources nor prompts, and the MCP client matrix does not list Tasks. A probe served a tool from the pinned `effect` under Bun. See [ARCHITECTURE.md](ARCHITECTURE.md#mcp-server) |
| 2026-10-05 | The loop and hooks judge by a base commit pinned at start, count the attempts themselves, and rerun after every agent exit. A local pass never replaces the pull request's job | Claude Code resets its Stop-hook cap whenever the agent calls a tool, and a capped `claude -p` run still reported success. Codex 0.160.0 blocked 81 times without a limit. An agent with a shell can edit hook settings and `observed.json`. See [ARCHITECTURE.md](ARCHITECTURE.md#local-results-and-the-ci-verdict) |
| 2026-10-05 | Phase 4 stays after gates 1 to 8, and starts with the loop. The MCP server comes after the hooks | A loop drives a candidate toward its checks, so it is only as sound as they are. Without the loop, an MCP tool gives an agent little that `observe --json` in its shell does not |
| 2026-10-05 | Recipe differences cover every field of `observed.json`, not only journeys. A changed field outside the journeys, such as `source`, `setup` or `start`, makes every check unknown, as an altered journey does. Gate 5 includes it | Both captures use the working tree's `observed.json`, so a change could point `start` at a stub server and the pull request job would pass |

The maintainer delegated the 2026-09-29 rows, every 2026-10-03 row after
the first, and the 2026-10-05 rows. Reverse any of them here. Two things stay with the maintainer. One
is recruiting the people for gates 9 and 10. The other is whether a required
Observed job gets a bypass rule.

## Pilot and continuation gates

Recruit six to eight developers across at least five repositories and two agent environments. Include frequent and occasional agent users. Observe actual tasks, startup work, interruptions, trusted evidence, and incorrect agent claims. Compare with each user's best existing setup.

For roughly 30 suitable changes, alternate workflow order where practical. Separate onboarding, active human checking, unattended execution, and maintenance. Independently inspect failures and sampled passes. Include seeded regressions with known outcomes.

These are proposed pilot targets, not measured results or statistical guarantees:

| Gate | Target or observation |
| --- | --- |
| Setup | First useful report within 10 minutes on a documented compatible project. Record excluded installation and credential time separately |
| Repeated effort | At least 30% lower median active verification time, reporting paired results and variation |
| Comprehension | Most participants identify the change, check scope, and next action within one minute without explanation |
| Result integrity | No false pass caused by missing evidence, stale revision, blocked checks, or collector failure in the pilot |
| Unrelated failures | Count runs that are unavailable for reasons outside the change, such as the expired self-observe fixture on 2026-09-28. Each one names its cause |
| Change scope | Count changed files still not observed after generated journeys, and how often a person had to step in |
| Detection | Report precision and seeded-regression detection by category. Explain misses and track escaped regressions |
| Continued use | At least three users keep the trigger enabled for two weeks and maintain recipes without recurring author intervention |
| Cost | Saved effort exceeds setup and maintenance. Track browser time, model cost, and storage |

If existing skills and reports solve the problem, publish the smaller solution. If users value one evidence type, narrow scope before adding domains.

## Optional experiments

None of these is an MVP requirement, and running one does not make a result
more reliable. Each stays outside the release path and must beat the simpler
method on the same cases.

A first pass on 2026-09-29 tried two invariants, each with a correct model and
a seeded fault. The first comes from Observed's code and says that a run with
an unavailable journey never concludes no regression. The second is an
ordering property. It says that a cancel arriving while a capture runs, with
no finish before it, is never followed by completion.

| | Lean 4 | Bend 2.0.34 | TLA+ with TLC |
| --- | --- | --- | --- |
| Precedence invariant | Proved for any list of journeys | Proved over presence flags | Not modeled |
| Cancellation invariant | Proved for any events before the cancel that are not a finish | Proved only when the cancel comes first | Checked over every reachable state of the model |
| Seeded fault | Proof fails | Proof fails, naming the case and both terms | Counterexample trace |
| Open proof | Exit 0 with a warning. `#print axioms` shows `sorryAx` | Exit 1 | Does not apply |
| Adding a verdict kind | Proofs untouched, one bound in the statement changed | The law and the proof both changed | Not tried |
| Tie to TypeScript | None built in | Emits the model as JavaScript, which ran against `summarizeJourneys` | None built in |
| Risk | Large install | New in September 2026, and its site says to expect bugs. `--verdict` needs Lean. It checks bend-lang.com for a new version daily unless `BEND_NO_TELEMETRY=1` is set. Linux, macOS or WSL | Bounded to the states in the model |

| Need | Tool |
| --- | --- |
| Properties of the real functions, in CI | fast-check |
| A small finite model that needs a conformance run against TypeScript | Bend |
| Statements over unbounded data | Lean |
| Orderings and interleavings, where a counterexample trace is the useful output | TLC |

The cancellation models describe the property. Nobody has tied them to
`src/capture/coordinator.ts`, so they say nothing about Observed's code yet.
A proved model says nothing about an application until a conformance run ties
it to the code. The longer experiment still has to compare setup,
specification effort, and proof maintenance on real changes.

[Jev](https://pydantic.dev/docs/ai/models/typesafe.md) answers typed questions
with a probability. Measure its accuracy on Observed's own cases before
relying on it. Two uses are worth testing, both as proposal sources. One is
writing generated journeys for changes that are not observed, in parallel
browser sessions. The other is routing, which needs roughly 150 to 300
labeled cases, split by repository or later time and including stale and
adversarial inputs, to compare it with rules and the existing model on missed
required checks, abstentions, latency and cost. That comparison is screening,
not rare-event safety evidence. Jev never decides a measurement, a permission
or a verdict.

For existing TypeScript invariants, try property-based testing before
translating code into another language.

Revisit backend priority, a persistent runner, and native React
instrumentation only when pilot evidence identifies a repeated need.

## Keep the plan small

Update the owning document and link to it. Keep the plan to three files, and
add a section only when it changes implementation or acceptance.
[CONFIGURATION.md](CONFIGURATION.md) and [GITHUB.md](GITHUB.md) are reference
for people using Observed, not plan. Three files is a project choice that
follows [Anthropic's context guidance](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents),
not a proven optimum.
