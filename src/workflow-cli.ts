import { BunRuntime, BunServices } from '@effect/platform-bun';
import {
  Cause,
  Console,
  Effect,
  FileSystem,
  Option,
  Result,
  Schema,
} from 'effect';
import { Argument, Command, Flag, Prompt } from 'effect/unstable/cli';
import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { captureApplication } from './capture/coordinator';
import { observedVersion } from './capture/provenance';
import { conclusionExitCodes as exitCodes } from './comparison-model';
import { json } from './encoding';
import { exportComparison } from './export';
import { agentBrowserPath, unsupportedBun } from './installation';
import { importExitCodes, importPlaywright } from './playwright/import';
import {
  agentLaunch,
  agents,
  agentTitles,
  detectAgents,
  githubRepository,
  openCodeMajor,
  guideSection,
  requiredCheckStep,
  setupPrompt,
  skillText,
  workflowStep,
  type Agent,
  type Ask,
  type Consent,
  type Answer,
  type Say,
  type Shell,
  type Step,
} from './guided-setup';
import { loadProject, projectSchema } from './project';
import { serveReport, ViewFailure } from './view';
import { buildViewer, runProject } from './workflow';

const toolRoot = path.resolve(import.meta.dirname, '..');

class SetupFailure extends Schema.TaggedError<SetupFailure>()('SetupFailure', {
  message: Schema.String,
}) {}
const outputFlag = Flag.String('output').pipe(
  Flag.withDescription('New directory for the evidence; default .observed/'),
  Flag.optional,
);
const machineFlag = Flag.Boolean('json').pipe(
  Flag.withDescription('Print the result as JSON on stdout and exit'),
  Flag.withDefault(false),
);
const timeoutFlag = Flag.Int('timeout').pipe(
  Flag.withDescription('Milliseconds allowed for each capture, from setup on'),
  Flag.withSchema(Schema.Int.check(Schema.isGreaterThan(0))),
  Flag.withDefault(120_000),
);

const printJson = (value: unknown) =>
  Effect.sync(() => process.stdout.write(json(value)));

const evidenceRoot = (base: string) => path.join(base, '.observed');

// The directory ignores itself so evidence never shows up in the
// application's Git status.
const makeEvidenceRoot = Effect.fnUntraced(function* (base: string) {
  const fs = yield* FileSystem.FileSystem;
  const root = evidenceRoot(base);
  yield* fs.makeDirectory(root, { recursive: true });
  yield* fs
    .writeFileString(path.join(root, '.gitignore'), '*\n', { flag: 'wx' })
    .pipe(
      Effect.catchTag('PlatformError', (error) =>
        error.reason._tag === 'AlreadyExists'
          ? Effect.void
          : Effect.fail(error),
      ),
    );

  return root;
});

const chooseDirectory = Effect.fnUntraced(function* (
  output: Option.Option<string>,
  prefix: string,
  base: string,
) {
  const fs = yield* FileSystem.FileSystem;

  if (Option.isSome(output)) {
    const directory = path.resolve(output.value);
    yield* fs.makeDirectory(path.dirname(directory), { recursive: true });

    return directory;
  }

  return path.join(yield* makeEvidenceRoot(base), `${prefix}-${randomUUID()}`);
});

const saveLatest = Effect.fnUntraced(function* (
  directory: string,
  base: string,
) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.writeFileString(
    path.join(yield* makeEvidenceRoot(base), 'latest.json'),
    json({ directory }),
  );
});

const openViewer = Effect.fnUntraced(function* (
  directory: string,
  port: number = 4173,
) {
  const url = yield* serveReport({ directory, port });
  yield* Console.log(
    `Observed: ${String(url)}\nEvidence: ${directory}\nPress Ctrl+C to stop.`,
  );
  yield* Effect.never;
});

const observe = Command.make(
  'observe',
  {
    project: Argument.String('project').pipe(
      Argument.withDescription('Directory containing observed.json'),
      Argument.withDefault('.'),
    ),
    base: Flag.String('base').pipe(
      Flag.withDescription('Revision to compare against, such as HEAD'),
      Flag.optional,
    ),
    candidate: Flag.String('candidate').pipe(
      Flag.withDescription('Revision to capture instead of the working tree'),
      Flag.optional,
    ),
    output: outputFlag,
    machine: machineFlag,
    headless: Flag.Boolean('headless').pipe(
      Flag.withDescription(
        'Exit after writing the report instead of opening it',
      ),
      Flag.withDefault(false),
    ),
    timeout: timeoutFlag,
  },
  Effect.fn('observeCommand')(function* ({
    project,
    base,
    candidate,
    output,
    machine,
    headless,
    timeout,
  }) {
    const projectRoot = path.resolve(project);
    const directory = yield* chooseDirectory(output, 'run', projectRoot);
    const requestedBase = Option.getOrNull(base);
    const exported = yield* runProject({
      projectRoot,
      toolRoot,
      directory,
      baseRevision: requestedBase === 'none' ? null : requestedBase,
      candidateRevision: Option.getOrNull(candidate),
      timeoutMs: timeout,
      quiet: machine,
    });
    // An explicit --output leaves the application's directory untouched.
    if (Option.isNone(output)) {
      yield* saveLatest(exported.directory, projectRoot);
    }

    if (machine) {
      yield* printJson(exported);
    } else {
      yield* Console.log(
        `${exported.result.title}\n${exported.result.conclusion.text}`,
      );
    }

    if (machine || headless) {
      process.exitCode = exitCodes[exported.result.conclusion.kind];

      return;
    }

    yield* openViewer(exported.directory);
  }),
).pipe(
  Command.withDescription(
    'Show the running application; use --base to compare a revision',
  ),
);

const capture = Command.make(
  'capture',
  {
    project: Argument.String('project').pipe(
      Argument.withDescription('Directory containing observed.json'),
    ),
    revision: Flag.String('revision').pipe(
      Flag.withDescription('Revision to capture instead of the working tree'),
      Flag.optional,
    ),
    journey: Flag.String('journey').pipe(
      Flag.withDescription('Journey name to capture; default the first'),
      Flag.optional,
    ),
    output: outputFlag,
    machine: machineFlag,
    timeout: timeoutFlag,
  },
  Effect.fn('captureCommand')(function* ({
    project: directory,
    revision,
    journey,
    output,
    machine,
    timeout,
  }) {
    const { root, project, recipes } = yield* loadProject(
      path.resolve(directory),
    );
    const requested = Option.getOrNull(journey);
    const recipe =
      requested === null
        ? recipes[0]
        : recipes.find((item) => item.name === requested);

    if (recipe === undefined) {
      return yield* new SetupFailure({
        message: `No journey named ${JSON.stringify(requested)}. Journeys: ${recipes.map((item) => JSON.stringify(item.name)).join(', ')}`,
      });
    }

    const destination = yield* chooseDirectory(output, 'capture', root);
    const captured = yield* captureApplication({
      projectRoot: root,
      toolRoot,
      directory: destination,
      project,
      recipe,
      revision: Option.getOrNull(revision),
      label: Option.getOrElse(revision, () => 'Worktree'),
      timeoutMs: timeout,
    });
    if (machine) {
      yield* printJson(captured);
    } else {
      yield* Console.log(
        `Capture ${captured.manifest.execution.kind}: ${destination}`,
      );
    }

    if (captured.manifest.execution.kind === 'failed') {
      process.exitCode = 1;
    }
  }),
).pipe(
  Command.withDescription('Capture one project revision for agent workflows'),
);

const compare = Command.make(
  'compare',
  {
    base: Argument.String('base-directory-or-none').pipe(
      Argument.withDescription('Base capture directory, or none for a preview'),
    ),
    candidate: Argument.String('candidate-directory').pipe(
      Argument.withDescription('Candidate capture directory'),
    ),
    output: outputFlag,
    machine: machineFlag,
  },
  Effect.fn('compareCommand')(function* ({ base, candidate, output, machine }) {
    const directory = yield* chooseDirectory(
      output,
      'comparison',
      process.cwd(),
    );
    const exported = yield* Effect.scoped(
      Effect.gen(function* () {
        return yield* exportComparison({
          journeys: [
            {
              baseDirectory: base === 'none' ? null : path.resolve(base),
              candidateDirectory: path.resolve(candidate),
            },
          ],
          directory,
          viewerDirectory: yield* buildViewer(toolRoot),
          mode: base === 'none' ? 'preview' : 'comparison',
        });
      }),
    );
    if (Option.isNone(output)) {
      yield* saveLatest(exported.directory, process.cwd());
    }

    if (machine) {
      yield* printJson(exported);
    } else {
      yield* Console.log(
        `${exported.result.conclusion.text}\nEvidence: ${directory}`,
      );
    }

    process.exitCode = exitCodes[exported.result.conclusion.kind];
  }),
).pipe(
  Command.withDescription('Compare captured evidence and export the viewer'),
);

const view = Command.make(
  'view',
  {
    directory: Argument.String('report-directory').pipe(
      Argument.withDescription(
        "Report to open, or an app directory to open its latest run; default the current directory's latest run",
      ),
      Argument.optional,
    ),
    port: Flag.Int('port').pipe(
      Flag.withDescription('Local port for the viewer'),
      Flag.withSchema(
        Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 65535 })),
      ),
      Flag.withDefault(4173),
    ),
  },
  Effect.fn('viewCommand')(function* ({ directory, port }) {
    const fs = yield* FileSystem.FileSystem;
    const requested = path.resolve(Option.getOrElse(directory, () => '.'));
    const latestFile = path.join(evidenceRoot(requested), 'latest.json');
    let selected = Option.getOrNull(directory);

    if (selected === null || (yield* fs.exists(latestFile))) {
      if (!(yield* fs.exists(latestFile))) {
        return yield* new ViewFailure({
          message: `No saved run in ${evidenceRoot(requested)}. Pass the application's directory or the report directory that observe printed.`,
        });
      }

      const latest = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(
          Schema.Struct({ directory: Schema.NonEmptyString }),
        ),
      )(yield* fs.readFileString(latestFile));
      selected = latest.directory;
    }

    if (!(yield* fs.exists(path.join(selected, 'selection.json')))) {
      return yield* new ViewFailure({
        message: `${path.resolve(selected)} is not a report directory, and it has no .observed/ runs. Pass the directory that observe printed, or the application's directory.`,
      });
    }

    yield* openViewer(path.resolve(selected), port);
  }),
).pipe(Command.withDescription('View a saved comparison'));

const importPlaywrightCommand = Command.make(
  'playwright',
  {
    report: Argument.String('report').pipe(
      Argument.withDescription(
        'Playwright HTML report directory, or a JSON report file',
      ),
    ),
    root: Flag.String('root').pipe(
      Flag.withDescription(
        "For a JSON report, the directory its attachments must be under; default the report's directory",
      ),
      Flag.optional,
    ),
    output: outputFlag,
    machine: machineFlag,
  },
  Effect.fn('importPlaywrightCommand')(function* ({
    report,
    root,
    output,
    machine,
  }) {
    const directory = yield* chooseDirectory(output, 'import', process.cwd());
    const imported = yield* importPlaywright({
      input: path.resolve(report),
      root: Option.match(root, {
        onNone: () => null,
        onSome: (value) => path.resolve(value),
      }),
      directory,
      observedVersion: yield* observedVersion(toolRoot),
    });

    if (machine) {
      yield* printJson(imported);
    } else {
      yield* Console.log(
        `${imported.manifest.conclusion.text}
Report: ${imported.report}`,
      );
    }

    process.exitCode = importExitCodes[imported.manifest.conclusion.kind];
  }),
).pipe(
  Command.withDescription(
    "Import a Playwright run's results as evidence, one check per test",
  ),
);

const importCommand = Command.make('import').pipe(
  Command.withDescription("Import another tool's results as evidence"),
  Command.withSubcommands([importPlaywrightCommand]),
);

const setup = Command.make(
  'setup',
  {
    withDeps: Flag.Boolean('with-deps').pipe(
      Flag.withDescription(
        "Also install Chrome's Linux system packages with sudo apt",
      ),
      Flag.withDefault(false),
    ),
  },
  Effect.fn('setupCommand')(function* ({ withDeps }) {
    // Chrome for Testing, which agent-browser installs, has no Linux arm64 build.
    if (process.platform === 'linux' && process.arch === 'arm64') {
      return yield* new SetupFailure({
        message:
          'Observed does not support Linux on arm64: Chrome for Testing publishes no Linux arm64 build. Use Linux on x64 or macOS.',
      });
    }

    const agentBrowser = yield* Effect.try({
      try: () => agentBrowserPath(toolRoot),
      catch: () =>
        new SetupFailure({
          message: `agent-browser is not installed next to Observed in ${toolRoot}. Reinstall Observed.`,
        }),
    });
    const code = yield* Effect.promise(
      () =>
        Bun.spawn(
          [
            process.execPath,
            agentBrowser,
            'install',
            ...(withDeps ? ['--with-deps'] : []),
          ],
          { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' },
        ).exited,
    );

    process.exitCode = code;
  }),
).pipe(Command.withDescription('Download the Chrome build that capture uses'));

const skill = Command.make(
  'skill',
  {},
  Effect.fn('skillCommand')(function* () {
    const fs = yield* FileSystem.FileSystem;
    const readme = yield* fs
      .readFileString(path.join(toolRoot, 'README.md'))
      .pipe(Effect.orElseSucceed(() => ''));
    const text = skillText({
      version: yield* observedVersion(toolRoot),
      guide: guideSection(readme),
    });

    yield* Effect.sync(() => process.stdout.write(text));
  }),
).pipe(
  Command.withDescription(
    'Print the guide a coding agent follows to set up and run Observed',
  ),
);

const schema = Command.make('schema', {}, () =>
  printJson(Schema.toJsonSchemaDocument(projectSchema).schema),
).pipe(Command.withDescription('Print the JSON Schema for observed.json'));

// Exit code when bare observed stops at a setup step it cannot take alone.
const setupNeeded = 3;

const bunShell: Shell = (argv, options) =>
  Effect.promise(async () => {
    try {
      const child = Bun.spawn([...argv], {
        cwd: options.cwd,
        stdin:
          options.input === undefined
            ? 'ignore'
            : new TextEncoder().encode(options.input),
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);

      return { code, stdout, stderr };
    } catch (error) {
      return {
        code: 127,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
      };
    }
  });

// Gives the terminal to an interactive agent and waits for it to exit. The
// prompt library leaves raw mode on for a moment after its last question, and
// the agent would inherit it: no Ctrl+C, and raw mode again once it exits.
const handOver = (argv: readonly string[], cwd: string) =>
  Effect.promise(async () => {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }

    // observed.json decides what happens next, not how the agent exited, so
    // only a failure to start is reported.
    try {
      await Bun.spawn([...argv], {
        cwd,
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
      }).exited;

      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });

const isExecutable = (file: string) => {
  try {
    accessSync(file, constants.X_OK);

    return true;
  } catch {
    return false;
  }
};

function consentFor(options: {
  dryRun: boolean;
  yes: boolean;
  interactive: boolean;
}): Consent {
  if (options.dryRun) {
    return 'dry-run';
  }

  if (options.yes) {
    return 'yes';
  }

  return options.interactive ? 'ask' : 'no-terminal';
}

const agentChoiceFlag = Flag.Literals('agent', [
  ...agents,
  'prompt',
] as const).pipe(
  Flag.withDescription(
    'Agent to open when observed.json is missing or invalid, or prompt to print the setup prompt instead',
  ),
  Flag.optional,
);

type Next = { step: string; instruction: string; prompt?: string };
type ExportedComparison = Effect.Success<ReturnType<typeof runProject>>;

const guided = Effect.fn('guidedSetup')(function* (options: {
  project: string;
  agent: Option.Option<Agent | 'prompt'>;
  yes: boolean;
  dryRun: boolean;
  machine: boolean;
  timeout: number;
}) {
  const fs = yield* FileSystem.FileSystem;
  const version = yield* observedVersion(toolRoot);
  const projectRoot = yield* fs.realPath(path.resolve(options.project));
  const interactive =
    !options.machine &&
    process.stdin.isTTY === true &&
    process.stdout.isTTY === true;
  const consent = consentFor({ ...options, interactive });
  const steps: Step[] = [];
  const say: Say = (text) =>
    options.machine ? Effect.void : Console.log(text);
  const terminal = yield* Effect.context<Prompt.Environment>();
  const ask: Ask = (message, initial = false) =>
    Prompt.run(Prompt.Confirm({ message, initial })).pipe(
      Effect.map((yes): Answer => (yes ? 'yes' : 'no')),
      Effect.orElseSucceed((): Answer => 'cancelled'),
      Effect.provideContext(terminal),
    );
  const marks = {
    done: '✓',
    skipped: '-',
    planned: '·',
    declined: '-',
    'needs-answer': '?',
    failed: '✗',
  } satisfies Record<Step['status'], string>;
  const record = (step: Step) =>
    Effect.gen(function* () {
      steps.push(step);
      yield* say(`${marks[step.status]} ${step.detail}`);
    });
  const finish = (
    next: Next | null,
    run: ExportedComparison | null,
    code: number,
  ) =>
    Effect.gen(function* () {
      if (options.machine) {
        yield* printJson({ steps, next, run });
      } else if (next !== null) {
        yield* Console.log(
          `\nNext: ${next.instruction}${next.prompt === undefined ? '' : `\n\n${next.prompt}`}`,
        );
      }

      process.exitCode = code;
    });

  yield* record({ id: 'bun', status: 'done', detail: `Bun ${Bun.version}` });

  const browsers = path.join(homedir(), '.agent-browser', 'browsers');
  const browserReady =
    (yield* fs
      .readDirectory(browsers)
      .pipe(Effect.orElseSucceed((): string[] => []))).length > 0;

  if (browserReady) {
    yield* record({
      id: 'browser',
      status: 'done',
      detail: 'Browser installed',
    });
  } else if (consent === 'dry-run') {
    yield* record({
      id: 'browser',
      status: 'planned',
      detail:
        'Would download Chrome for Testing with observed setup, about 190 MB',
    });
  } else {
    const install =
      consent === 'yes' ||
      (consent === 'ask' &&
        (yield* ask('Download Chrome for Testing now, about 190 MB?')) ===
          'yes');

    if (!install) {
      yield* record({
        id: 'browser',
        status: 'needs-answer',
        detail: 'No browser to capture with',
      });

      return yield* finish(
        {
          step: 'browser',
          instruction: 'Run observed setup, then observed again.',
        },
        null,
        setupNeeded,
      );
    }

    const installed = yield* Effect.promise(
      () =>
        Bun.spawn([process.execPath, agentBrowserPath(toolRoot), 'install'], {
          stdin: 'ignore',
          stdout: options.machine ? 2 : 'inherit',
          stderr: 'inherit',
        }).exited,
    );

    if (installed !== 0) {
      yield* record({
        id: 'browser',
        status: 'failed',
        detail: 'The browser download failed',
      });

      return yield* finish(
        {
          step: 'browser',
          instruction:
            'Run observed setup, or observed setup --with-deps on Linux without desktop libraries, then observed again.',
        },
        null,
        1,
      );
    }

    yield* record({
      id: 'browser',
      status: 'done',
      detail: 'Browser installed',
    });
  }

  const gh = yield* bunShell(['gh', 'auth', 'status'], { cwd: projectRoot });
  const gitRoot = yield* bunShell(['git', 'rev-parse', '--show-toplevel'], {
    cwd: projectRoot,
  }).pipe(
    Effect.map((result) => (result.code === 0 ? result.stdout.trim() : null)),
  );
  const remote =
    gitRoot === null
      ? null
      : yield* bunShell(['git', 'remote', 'get-url', 'origin'], {
          cwd: gitRoot,
        }).pipe(
          Effect.map((result) =>
            result.code === 0 ? githubRepository(result.stdout) : null,
          ),
        );
  const repository = gh.code === 0 ? remote : null;

  yield* record(
    gh.code === 0
      ? { id: 'gh', status: 'done', detail: 'GitHub CLI signed in' }
      : {
          id: 'gh',
          status: 'skipped',
          detail:
            'GitHub steps skipped: install gh and run gh auth login to add the workflow.',
        },
  );
  yield* record(
    remote === null
      ? {
          id: 'remote',
          status: 'skipped',
          detail:
            gitRoot === null
              ? 'GitHub steps skipped: this directory is not in a Git repository.'
              : 'GitHub steps skipped: origin is not a GitHub repository.',
        }
      : { id: 'remote', status: 'done', detail: `GitHub repository ${remote}` },
  );

  const project =
    gitRoot === null
      ? '.'
      : path.relative(yield* fs.realPath(gitRoot), projectRoot);
  const projectPath = project === '' ? '.' : project;
  const capture = Effect.gen(function* () {
    return yield* runProject({
      projectRoot,
      toolRoot,
      directory: yield* chooseDirectory(Option.none(), 'run', projectRoot),
      baseRevision: null,
      candidateRevision: null,
      timeoutMs: options.timeout,
      quiet: options.machine,
    });
  });
  const loaded = yield* loadProject(projectRoot).pipe(Effect.result);
  let run: ExportedComparison | null = null;
  let configured = false;

  if (Result.isSuccess(loaded)) {
    yield* record({
      id: 'config',
      status: 'done',
      detail: 'observed.json is valid',
    });
  } else {
    const missing = !(yield* fs.exists(
      path.join(projectRoot, 'observed.json'),
    ));
    const found = detectAgents(process.env.PATH ?? '', isExecutable);
    const openCodeVersion = found.includes('opencode')
      ? (yield* bunShell(['opencode', '--version'], { cwd: projectRoot }))
          .stdout
      : null;
    // OpenCode's installer can add opencode2 as a wrapper around the same
    // opencode, so it is offered once.
    const sameOpenCode =
      openCodeVersion !== null &&
      found.includes('opencode2') &&
      (yield* bunShell(['opencode2', '--version'], { cwd: projectRoot }))
        .stdout === openCodeVersion;
    const detected = sameOpenCode
      ? found.filter((agent) => agent !== 'opencode2')
      : found;
    const prompt = setupPrompt(version, missing ? 'missing' : 'invalid');
    const plan = () => {
      const chosen = Option.getOrNull(options.agent);

      if (chosen === 'prompt' || !interactive || detected.length === 0) {
        return `Would print this prompt for your coding agent: ${prompt}`;
      }

      if (chosen !== null) {
        return `Would open ${agentTitles[chosen]} with: ${prompt}`;
      }

      return `Would offer to open ${detected.map((agent) => agentTitles[agent]).join(' or ')} with: ${prompt}`;
    };

    yield* record({
      id: 'config',
      status: 'needs-answer',
      detail: missing
        ? 'No observed.json yet'
        : `observed.json is invalid: ${loaded.failure.message}`,
    });

    if (consent === 'dry-run') {
      yield* record({ id: 'config', status: 'planned', detail: plan() });
    } else {
      const choose = (): Effect.Effect<
        Agent | 'prompt' | 'cancelled' | null
      > => {
        const [first] = detected;

        if (Option.isSome(options.agent)) {
          return Effect.succeed(options.agent.value);
        }

        if (!interactive) {
          return Effect.succeed(null);
        }

        if (first === undefined) {
          return Effect.succeed('prompt');
        }

        if (consent === 'yes') {
          return Effect.succeed(first);
        }

        if (detected.length === 1) {
          return ask(
            `Open ${agentTitles[first]} here to set up observed.json?`,
            true,
          ).pipe(
            Effect.map((answer) => {
              switch (answer) {
                case 'yes':
                  return first;
                case 'no':
                  return 'prompt' as const;
                case 'cancelled':
                  return 'cancelled' as const;
              }
            }),
          );
        }

        return Prompt.run(
          Prompt.Select<Agent | 'prompt'>({
            message: 'Set up observed.json with',
            choices: [
              ...detected.map((agent) => ({
                title: agentTitles[agent],
                value: agent,
              })),
              {
                title: 'Print a prompt for another agent',
                value: 'prompt' as const,
              },
            ],
          }),
        ).pipe(
          Effect.orElseSucceed(() => 'cancelled' as const),
          Effect.provideContext(terminal),
        );
      };

      const chosen = yield* choose();

      if (chosen === 'cancelled') {
        return yield* finish(
          {
            step: 'config',
            instruction: 'Run observed again to set up observed.json.',
          },
          null,
          setupNeeded,
        );
      }

      if (chosen === null || chosen === 'prompt') {
        return yield* finish(
          {
            step: 'config',
            instruction:
              'Give this prompt to your coding agent, then run observed again.',
            prompt,
          },
          null,
          setupNeeded,
        );
      }

      if (!interactive || !detected.includes(chosen)) {
        yield* record({
          id: 'config',
          status: 'failed',
          detail: interactive
            ? `${chosen} is not on PATH`
            : `${agentTitles[chosen]} opens only in a terminal, and never with --json`,
        });

        return yield* finish(
          {
            step: 'config',
            instruction:
              'Give this prompt to your coding agent, then run observed again.',
            prompt,
          },
          null,
          setupNeeded,
        );
      }

      const launch = agentLaunch(
        chosen,
        prompt,
        chosen === 'opencode' && openCodeVersion !== null
          ? openCodeMajor(openCodeVersion)
          : null,
      );

      yield* say(
        `Opening ${agentTitles[chosen]} with: ${prompt}\n${launch.sends ? '' : `Press Enter in ${agentTitles[chosen]} to send it. `}Quit it when observed.json works, and setup continues here.`,
      );
      const failedToStart = yield* handOver(launch.argv, projectRoot);

      if (failedToStart !== null) {
        yield* record({
          id: 'config',
          status: 'failed',
          detail: `${agentTitles[chosen]} did not start: ${failedToStart}`,
        });

        return yield* finish(
          {
            step: 'config',
            instruction:
              'Give this prompt to your coding agent, then run observed again.',
            prompt,
          },
          null,
          setupNeeded,
        );
      }

      const checked = yield* loadProject(projectRoot).pipe(Effect.result);

      if (Result.isFailure(checked)) {
        const written = yield* fs.exists(
          path.join(projectRoot, 'observed.json'),
        );

        yield* record({
          id: 'config',
          status: written ? 'failed' : 'needs-answer',
          detail: written
            ? `observed.json is still not valid: ${checked.failure.message}`
            : 'No observed.json yet',
        });

        return yield* finish(
          {
            step: 'config',
            instruction:
              'Give this prompt to your coding agent, then run observed again.',
            prompt: setupPrompt(version, written ? 'invalid' : 'missing'),
          },
          null,
          setupNeeded,
        );
      }

      yield* record({
        id: 'config',
        status: 'done',
        detail: 'observed.json is valid',
      });
      configured = true;
    }
  }

  if (consent === 'dry-run') {
    yield* record({
      id: 'capture',
      status: 'planned',
      detail: 'Would capture the working tree and open the viewer',
    });
  } else {
    run = yield* capture;
    yield* saveLatest(run.directory, projectRoot);

    const { conclusion } = run.result;

    yield* record({
      id: 'capture',
      status: conclusion.kind === 'unavailable' ? 'failed' : 'done',
      detail: `${run.result.title}: ${conclusion.text}`,
    });

    if (conclusion.kind === 'unavailable') {
      return yield* finish(
        configured
          ? {
              step: 'capture',
              instruction:
                'Give this prompt to your coding agent, then run observed again.',
              prompt: setupPrompt(version, 'unavailable'),
            }
          : null,
        run,
        exitCodes.unavailable,
      );
    }
  }

  const viewer =
    interactive && run !== null
      ? yield* serveReport({ directory: run.directory, port: 4173 })
      : null;

  if (viewer !== null && run !== null) {
    yield* say(`Viewer: ${String(viewer)}\nEvidence: ${run.directory}`);
  }

  let next: Next | null = null;

  if (repository !== null && gitRoot !== null) {
    const scratch = yield* fs.makeTempDirectoryScoped({
      prefix: 'observed-setup-',
    });
    const workflow = yield* workflowStep({
      shell: bunShell,
      ask,
      say,
      consent,
      gitRoot,
      project: projectPath,
      repository,
      version,
      observed: evidenceRoot(projectRoot),
      scratch,
    });

    yield* record(workflow.step);

    if (workflow.kind === 'waiting') {
      next = { step: 'workflow', instruction: workflow.next };
    }

    const base =
      workflow.kind !== 'ready'
        ? null
        : (workflow.base ??
          (yield* bunShell(
            [
              'gh',
              'repo',
              'view',
              repository,
              '--json',
              'defaultBranchRef',
              '--jq',
              '.defaultBranchRef.name',
            ],
            { cwd: gitRoot },
          ).pipe(
            Effect.map((result) =>
              result.code === 0 && result.stdout.trim() !== ''
                ? result.stdout.trim()
                : null,
            ),
          )));

    if (base !== null) {
      yield* record(
        yield* requiredCheckStep({
          shell: bunShell,
          ask,
          say,
          consent,
          repository,
          base,
          cwd: gitRoot,
        }),
      );
    }
  }

  yield* finish(
    next,
    run,
    run === null ? 0 : exitCodes[run.result.conclusion.kind],
  );

  if (viewer !== null) {
    yield* Console.log('Press Ctrl+C to stop the viewer.');
    yield* Effect.never;
  }
});

const root = Command.make(
  'observed',
  {
    project: Flag.String('project').pipe(
      Flag.withDescription('Directory containing observed.json; default .'),
      Flag.withDefault('.'),
    ),
    agent: agentChoiceFlag,
    yes: Flag.Boolean('yes').pipe(
      Flag.withDescription(
        'Answer yes to the browser download, opening the first agent found, the workflow, Dependabot and the setup pull request. Never creates a ruleset',
      ),
      Flag.withDefault(false),
    ),
    dryRun: Flag.Boolean('dry-run').pipe(
      Flag.withDescription(
        'Print the remaining setup steps and change nothing',
      ),
      Flag.withDefault(false),
    ),
    machine: machineFlag,
    timeout: timeoutFlag,
  },
  guided,
).pipe(
  Command.withDescription(
    'Run the setup steps still missing, then preview the app. observe, view and setup do one step each',
  ),
);

const unsupported = unsupportedBun();

if (unsupported !== null) {
  console.error(unsupported);
  process.exit(1);
}

observedVersion(toolRoot).pipe(
  Effect.flatMap((version) =>
    root.pipe(
      Command.withSubcommands([
        observe,
        setup,
        capture,
        compare,
        view,
        importCommand,
        skill,
        schema,
      ]),
      Command.run({ version }),
    ),
  ),
  Effect.provideService(
    Console.Console,
    process.argv.some(
      (argument) => argument === '--json' || argument === '--json=true',
    )
      ? { ...console, log: console.error }
      : console,
  ),
  Effect.scoped,
  Effect.provide(BunServices.layer),
  // Expected failures explain themselves; only defects need a stack trace.
  Effect.tapCause((cause) =>
    Console.error(
      Cause.hasDies(cause)
        ? Cause.pretty(cause)
        : Cause.prettyErrors(cause)
            .map((error) => error.message)
            .join('\n'),
    ),
  ),
  BunRuntime.runMain({ disableErrorReporting: true }),
);
