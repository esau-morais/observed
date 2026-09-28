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
  agentCommand,
  agents,
  agentTitles,
  detectAgents,
  githubRepository,
  guideSection,
  requiredCheckStep,
  workflowStep,
  writePrompt,
  type Agent,
  type Ask,
  type Consent,
  type Say,
  type Shell,
  type Step,
} from './guided-setup';
import { loadProject } from './project';
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

// Exit code when bare observed stops at a setup step it cannot take alone.
const setupNeeded = 3;

const toolFiles = [
  'package.json',
  'bun.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'index.html',
  'vite.config.js',
  'vite.config.ts',
  'vite.config.mjs',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'go.mod',
  'pyproject.toml',
  'requirements.txt',
  'Gemfile',
  'docker-compose.yml',
  'compose.yaml',
];

const scriptsSchema = Schema.fromJsonString(
  Schema.Struct({
    scripts: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  }),
);

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

const isExecutable = (file: string) => {
  try {
    accessSync(file, constants.X_OK);

    return true;
  } catch {
    return false;
  }
};

const gatherFacts = Effect.fnUntraced(function* (
  projectRoot: string,
  project: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const files: string[] = [];

  for (const file of toolFiles) {
    if (yield* fs.exists(path.join(projectRoot, file))) {
      files.push(file);
    }
  }

  const scripts = files.includes('package.json')
    ? Option.match(
        Schema.decodeUnknownOption(scriptsSchema)(
          yield* fs
            .readFileString(path.join(projectRoot, 'package.json'))
            .pipe(Effect.orElseSucceed(() => '')),
        ),
        { onNone: () => ({}), onSome: (value) => value.scripts ?? {} },
      )
    : {};

  return { directory: projectRoot, project, scripts, files };
});

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
    'Who writes a missing observed.json: an agent CLI on PATH, or prompt to print the prompt',
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
  const ask: Ask = (message) =>
    Prompt.run(Prompt.Confirm({ message, initial: false })).pipe(
      Effect.orElseSucceed(() => false),
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
        (yield* ask('Download Chrome for Testing now, about 190 MB?')));

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
        detail:
          'The browser download failed. On Linux without desktop libraries, run observed setup --with-deps.',
      });

      return yield* finish(null, null, 1);
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
    const detected = detectAgents(process.env.PATH ?? '', isExecutable);
    const facts = yield* gatherFacts(projectRoot, projectPath);
    const guide = guideSection(
      yield* fs
        .readFileString(path.join(toolRoot, 'README.md'))
        .pipe(Effect.orElseSucceed(() => '')),
    );
    const prompt = (failure: string | null) =>
      writePrompt({ facts, guide, version, failure });
    const firstFailure = missing ? null : loaded.failure.message;

    yield* record({
      id: 'config',
      status: 'needs-answer',
      detail: missing
        ? 'No observed.json yet'
        : `observed.json is invalid: ${loaded.failure.message}`,
    });

    if (consent === 'dry-run') {
      yield* record({
        id: 'config',
        status: 'planned',
        detail: `Would ask ${detected.length === 0 ? 'you' : detected.map((agent) => agentTitles[agent]).join(', ')} to write observed.json, then validate and capture it`,
      });

      return yield* finish(null, null, 0);
    }

    const pick = Prompt.run(
      Prompt.Select<Agent | 'prompt'>({
        message: 'Who writes observed.json?',
        choices: [
          ...detected.map((agent) => ({
            title: agentTitles[agent],
            value: agent,
            description: `Runs ${agentCommand(agent, '<prompt>', projectRoot).join(' ')} in ${projectRoot}`,
          })),
          {
            title: 'Show me the prompt',
            value: 'prompt' as const,
            description: 'Print it for any agent or for writing it yourself',
          },
        ],
      }),
    ).pipe(Effect.orElseSucceed(() => 'prompt' as const));
    let chosen: Agent | 'prompt' | null = null;

    if (Option.isSome(options.agent)) {
      chosen = options.agent.value;
    } else if (interactive) {
      chosen = yield* pick;
    }

    if (chosen === null || chosen === 'prompt') {
      return yield* finish(
        {
          step: 'config',
          instruction:
            chosen === null
              ? `Write observed.json with the prompt below, then run observed again. With a terminal, observed offers ${detected.length === 0 ? 'no agents, since none is on PATH' : detected.map((agent) => agentTitles[agent]).join(', ')}; without one, pass --agent.`
              : 'Give this prompt to your agent, then run observed again.',
          prompt: prompt(firstFailure),
        },
        null,
        setupNeeded,
      );
    }

    if (!detected.includes(chosen)) {
      yield* record({
        id: 'config',
        status: 'failed',
        detail: `${chosen} is not on PATH`,
      });

      return yield* finish(null, null, setupNeeded);
    }

    // The agent proposes; validation and the capture decide. A failure goes
    // back to the agent at most twice.
    let failure = firstFailure;

    for (let attempt = 0; attempt < 3 && run === null; attempt++) {
      const argv = agentCommand(chosen, prompt(failure), projectRoot);

      yield* say(
        `Running ${agentTitles[chosen]}: ${argv.slice(0, -1).join(' ')} <prompt>${chosen === 'claude' ? ` ${argv.slice(3).join(' ')}` : ''}`,
      );

      const code = yield* Effect.promise(
        () =>
          Bun.spawn(argv, {
            cwd: projectRoot,
            stdin: 'ignore',
            stdout: options.machine ? 2 : 'inherit',
            stderr: 'inherit',
          }).exited,
      );
      const checked = yield* loadProject(projectRoot).pipe(Effect.result);

      if (Result.isFailure(checked)) {
        failure = `${agentTitles[chosen]} exited with ${String(code)}. observed.json is not valid: ${checked.failure.message}`;
        yield* say(failure);
        continue;
      }

      const exported = yield* capture;

      if (exported.result.conclusion.kind === 'unavailable') {
        failure = `The capture was unavailable: ${exported.result.conclusion.text} ${exported.result.journeys
          .flatMap((journey) =>
            journey.comparison.kind === 'unavailable'
              ? journey.comparison.reasons
              : [],
          )
          .join(' ')} Evidence: ${exported.directory}`;
        yield* say(failure);
        continue;
      }

      run = exported;
    }

    if (run === null) {
      yield* record({
        id: 'config',
        status: 'failed',
        detail: `Stopped after three attempts. Last error: ${failure ?? 'none'}`,
      });

      return yield* finish(null, null, 1);
    }

    yield* record({
      id: 'config',
      status: 'done',
      detail: `${agentTitles[chosen]} wrote observed.json`,
    });
  }

  if (consent === 'dry-run') {
    yield* record({
      id: 'capture',
      status: 'planned',
      detail: 'Would capture the working tree and open the viewer',
    });
  } else {
    run ??= yield* capture;
    yield* saveLatest(run.directory, projectRoot);

    const { conclusion } = run.result;

    yield* record({
      id: 'capture',
      status: conclusion.kind === 'unavailable' ? 'failed' : 'done',
      detail: `${run.result.title}: ${conclusion.text}`,
    });

    if (conclusion.kind === 'unavailable') {
      return yield* finish(null, run, exitCodes.unavailable);
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

    if (workflow.next !== null) {
      next = { step: 'workflow', instruction: workflow.next };
    }

    if (workflow.step.status === 'done') {
      const base =
        workflow.base ??
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
        )).stdout.trim();

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
        'Answer yes to adding the workflow and opening the setup pull request, for agents you authorized',
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
