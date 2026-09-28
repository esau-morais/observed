# Record an interactive CLI flow

Use the standalone [Microsoft tui-test CLI, 0.1.0-beta.5](https://github.com/microsoft/tui-test/releases/tag/0.1.0-beta.5)
for this pilot. Its current implementation is a beta rewrite. Pin the executable;
do not add it to Observed's runtime dependencies or install the older npm `latest`
assuming it matches these instructions. MP4 recording requires FFmpeg.

The procedure below has been exercised on Linux with Bash and Bun 1.4.2. Other
platforms remain unverified. Record the producer version, binary hash, backend,
terminal dimensions, source commit and worktree diff with the evidence.

## Launch and record

Set `tui_bin` to the absolute executable path, `observed_root` to the source
checkout and `project_dir` to a disposable application directory. Use a new
directory and session for each flow. For onboarding, exercise both missing and
valid `observed.json`; the valid-config path skips agent selection. The existing
`tests/fixtures/form-redirect` fixture supplies a small app with a known check.
An installed browser is required to reach capture without the download prompt.

```bash
mkdir -p "$observed_root/evidence"
run_dir="$(mktemp -d "$observed_root/evidence/terminal.XXXXXX")"
session_name="observed-$(basename "$run_dir")"
cat > "$run_dir/tui-test.toml" <<EOF
[recording]
directory = "$run_dir/casts"
[trace]
mode = "on"
directory = "$run_dir/traces"
EOF

"$tui_bin" --version > "$run_dir/producer-version.txt"
"$tui_bin" --session "$session_name" run \
  --config "$run_dir/tui-test.toml" --cols 110 --rows 36 \
  --cwd "$project_dir" /bin/bash --noprofile --norc -c \
  'read -r -p "Press Enter to start Observed"; exec bun "$1/src/workflow-cli.ts"' \
  observed-launch "$observed_root"
"$tui_bin" --session "$session_name" record start "$run_dir/flow.mp4" --fps 10
"$tui_bin" --session "$session_name" key press Enter
```

Keep the controller alive through cleanup. Hosts that reap detached children
when a command finishes need a persistent shell or one controller process for
the whole flow. An immediately missing session is a failed launch, not app output.
The initial Enter gates launch so recording starts before Observed does.

## Observe before answering

Use `text` to read the current screen. Wait for the actual prompt with
`expect text 'visible prompt' --timeout 20000`, then save a screenshot with
`screenshot -o "$run_dir/prompt.png"`. Choose fresh filenames for later states.
Use `key press Down`, `type`, and `key press Enter` as the observed control needs.
Confirm the selected option before Enter. Do not send a positional list of answers
or use a fixed sleep as proof of readiness.

For a GitHub project with a valid config and no workflow, capture the completed
preview and the question `Open a pull request that runs Observed on every pull request?`.
Use the decline path unless the task authorizes creating that PR. After `type n`
and `key press Enter`, wait for `Press Ctrl+C to stop the viewer.` and inspect the
disposable project's `.observed/setup.json` for the recorded decline. Check the
capture's raw text artifact against the fixture expectation, not only the CLI's
passed label. These terminal screenshots do not independently prove the webpage
rendering or a revision comparison.

## Finish and inspect

For the running viewer, send `key press Ctrl+C`. A missing-config flow that prints
the setup prompt exits by itself. Then retain process state and finish recording:

```bash
"$tui_bin" --session "$session_name" wait exit --timeout 10000
"$tui_bin" --session "$session_name" --json state > "$run_dir/state.json"
"$tui_bin" --session "$session_name" text --full > "$run_dir/terminal.txt"
"$tui_bin" --session "$session_name" screenshot -o "$run_dir/final.png"
"$tui_bin" --session "$session_name" record stop
"$tui_bin" --session "$session_name" close
```

In this pinned version, `expect exit-code` reads shell-command status. A program
started with `run` instead reports `data.exited` and `data.exit_signal` in JSON
`state`. Check those fields against the expected outcome. Printing the setup
prompt exits 3; interrupting the viewer exits 130. An assertion timeout does not
establish either result.

If an earlier step fails, retain its trace, inspect current state, stop any active
recording and close this named session. Do not close unrelated sessions. Verify
that this run's viewer port and captured application processes were released.
Open the PNGs and inspect the recording before reporting success. Keep automatic
casts, assertion failures and raw application artifacts alongside the MP4;
record any capture or cleanup failure as unresolved.
