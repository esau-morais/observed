# TodoMVC completion and persistence recipe

Version: 5. Producer: agent-browser 0.38.1, using headless Chrome.
Target: <https://demo.playwright.dev/todomvc/> (public React demonstration).
No login, credentials, local application server, or package installation is needed
when this tool version and Chrome are installed.

Read the installed core skill with `agent-browser skills get core` before driving.
Use its built-in semantic locators, state queries, snapshots, and screenshots.
The metadata evaluation below reads browser conditions, not application state.

## Scope and expectations

Start each run in a new, exclusively owned browser session with an empty todo list.
Use the disposable title `Observed Phase 0 evidence` and a 1280 × 800 viewport.

1. Add the title with Enter: exactly one matching, incomplete todo appears.
2. Complete it: the checkbox is checked and zero items remain active.
3. Reload: the same todo remains completed.
4. Open Active: no todo is visible.
5. Open Completed: exactly the completed todo is visible.
6. Clear completed: the list is empty. Close only this run's browser session.

Shell assertions compare built-in browser query results with explicit expectations.
A failed command or assertion stops the run. Reload supplies a second read of
persisted state; backend persistence is outside scope. Snapshots and screenshots
retain the state around that check. No network, performance, accessibility
conformance, or source-causation check is performed.

## Executed commands

Run from the repository root. Use a new output directory and session prefix for
each execution. The existence check protects earlier evidence from overwriting.
`--no-sandbox` is a recorded local launch condition: the first discovery launch
failed because Chrome could not use a sandbox on this host.

```bash
set -eu

root="evidence/phase-0/todomvc/capture-05"
test ! -e "$root"
mkdir -p "$root"
(
  set -ex
  agent-browser --version > "$root/producer.txt"
  test "$(cat "$root/producer.txt")" = "agent-browser 0.38.1"
) > "$root/setup.log" 2>&1

for run in 1 2; do
  (
    set -ex
    AGENT_BROWSER_SESSION="$(agent-browser session id --scope worktree --prefix "observed-phase0-capture05-$run")"
    export AGENT_BROWSER_SESSION
    trap 'agent-browser close' EXIT
    date -u +%Y-%m-%dT%H:%M:%SZ
    agent-browser --args '--no-sandbox' open https://demo.playwright.dev/todomvc/
    agent-browser set viewport 1280 800
    agent-browser wait .new-todo
    agent-browser eval --stdin <<'JS'
({
  time: new Date().toISOString(),
  url: location.href,
  userAgent: navigator.userAgent,
  viewport: {
    width: innerWidth,
    height: innerHeight,
    dpr: devicePixelRatio
  },
  scripts: Array.from(document.scripts).map(element => element.src)
})
JS
    test "$(agent-browser get count '.todo-list li')" = 0
    agent-browser snapshot

    agent-browser find placeholder 'What needs to be done?' fill 'Observed Phase 0 evidence'
    agent-browser press Enter
    agent-browser wait --text 'Observed Phase 0 evidence'
    test "$(agent-browser get count '.todo-list li')" = 1
    test "$(agent-browser find testid todo-title text)" = 'Observed Phase 0 evidence'
    test "$(agent-browser is checked '.todo-list .toggle')" = false
    echo 'PASS add: one matching incomplete todo'
    agent-browser snapshot

    agent-browser find role checkbox check --name 'Toggle Todo'
    agent-browser wait --text '0 items left'
    test "$(agent-browser is checked '.todo-list .toggle')" = true
    test "$(agent-browser get text .todo-count)" = '0 items left'
    echo 'PASS complete: checked, zero active'

    agent-browser reload
    agent-browser wait --text 'Observed Phase 0 evidence'
    test "$(agent-browser get count '.todo-list li')" = 1
    test "$(agent-browser find testid todo-title text)" = 'Observed Phase 0 evidence'
    test "$(agent-browser is checked '.todo-list .toggle')" = true
    echo 'PASS reload: matching completed todo persisted'
    agent-browser snapshot
    agent-browser screenshot "$root/run-$run-reloaded.png"

    agent-browser find role link click --name Active --exact
    agent-browser wait --url '**/#/active'
    agent-browser wait --fn 'document.querySelectorAll(".todo-list li").length === 0'
    test "$(agent-browser get count '.todo-list li')" = 0
    echo 'PASS active filter: no visible todos'
    agent-browser snapshot

    agent-browser find role link click --name Completed --exact
    agent-browser wait --url '**/#/completed'
    agent-browser wait --text 'Observed Phase 0 evidence'
    test "$(agent-browser get count '.todo-list li')" = 1
    test "$(agent-browser find testid todo-title text)" = 'Observed Phase 0 evidence'
    test "$(agent-browser is checked '.todo-list .toggle')" = true
    echo 'PASS completed filter: matching completed todo visible'
    agent-browser snapshot
    agent-browser screenshot "$root/run-$run-completed.png"

    agent-browser find role link click --name All --exact
    agent-browser wait --url '**/#/'
    agent-browser find role button click --name 'Clear completed'
    agent-browser wait --fn 'document.querySelectorAll(".todo-list li").length === 0'
    test "$(agent-browser get count '.todo-list li')" = 0
    echo 'Empty fixture restored'
    agent-browser snapshot
    date -u +%Y-%m-%dT%H:%M:%SZ
  ) > "$root/run-$run.log" 2>&1
done
```

If an assertion fails, the transcript remains and the EXIT trap closes that run's
browser. Inspect the failure before starting a new capture directory. Never edit
an earlier transcript to turn a failed assertion into a pass.

## Limits

The demo can change without notice. The URL is attributable, but not an immutable
build identity. The deployed source revision is unknown. The two runs are
repetitions, not a baseline/candidate pair. Tool version and browser user agent are
recorded; no claim is made that the complete host environment is reproducible.
Closing the owned sessions discards their browser state and retains the files.
This is a contributor-run Phase 0 exercise, not evidence of pilot adoption or
reduced human verification time.

Local captures retain earlier recipe versions and failures. Version 2 replaced
custom application-state evaluation with built-in queries and updated the producer
version. Version 3 tried waiting for an empty list selector to become visible;
that timed out because an empty list has no height. Version 4 uses the documented
condition wait for zero rows. It keeps the original zero-row expectation. Results
across producer versions are not a controlled tool comparison. Version 5 also
retains producer-check commands, stderr, and failures in `setup.log`.

## Artifact handling

`evidence/` is local and gitignored. Retain screenshots, transcripts, failed runs,
and assembled reports there for inspection. Commit this recipe and useful
findings, not routine captures. Select and sanitize a fixture with provenance
only when a regression test or a report contract needs it. Shared CI evidence and
its retention policy remain future work.
