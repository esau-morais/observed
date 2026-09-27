import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Cause, Console, Effect, FileSystem, Option, Schema } from 'effect';
import { Argument, Command, Flag } from 'effect/unstable/cli';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { captureApplication } from './capture/coordinator';
import { observedVersion } from './capture/provenance';
import { conclusionExitCodes as exitCodes } from './comparison-model';
import { json } from './encoding';
import { exportComparison } from './export';
import { agentBrowserPath, unsupportedBun } from './installation';
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
    output: outputFlag,
    machine: machineFlag,
    timeout: timeoutFlag,
  },
  Effect.fn('captureCommand')(function* ({
    project: directory,
    revision,
    output,
    machine,
    timeout,
  }) {
    const { root, project, recipe } = yield* loadProject(
      path.resolve(directory),
    );
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
          baseDirectory: base === 'none' ? null : path.resolve(base),
          candidateDirectory: path.resolve(candidate),
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

const unsupported = unsupportedBun();

if (unsupported !== null) {
  console.error(unsupported);
  process.exit(1);
}

observedVersion(toolRoot).pipe(
  Effect.flatMap((version) =>
    Command.make('observed').pipe(
      Command.withSubcommands([observe, setup, capture, compare, view]),
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
