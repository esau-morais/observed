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
import { loadProject } from './project';
import { serveReport } from './view';
import { buildViewer, runProject } from './workflow';

const toolRoot = path.resolve(import.meta.dirname, '..');
const outputFlag = Flag.String('output').pipe(Flag.optional);
const machineFlag = Flag.Boolean('json').pipe(Flag.withDefault(false));
const timeoutFlag = Flag.Int('timeout').pipe(
  Flag.withSchema(Schema.Int.check(Schema.isGreaterThan(0))),
  Flag.withDefault(120_000),
);

const printJson = (value: unknown) =>
  Effect.sync(() => process.stdout.write(json(value)));

const chooseDirectory = Effect.fnUntraced(function* (
  output: Option.Option<string>,
  prefix: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const directory = path.resolve(
    Option.getOrElse(output, () =>
      path.join(toolRoot, 'evidence', `${prefix}-${randomUUID()}`),
    ),
  );
  yield* fs.makeDirectory(path.dirname(directory), { recursive: true });

  return directory;
});

const saveLatest = Effect.fnUntraced(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(path.join(toolRoot, 'evidence'), { recursive: true });
  yield* fs.writeFileString(
    path.join(toolRoot, 'evidence/latest.json'),
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

const run = Command.make(
  'run',
  {
    project: Argument.String('project').pipe(Argument.withDefault('.')),
    base: Flag.String('base').pipe(Flag.optional),
    candidate: Flag.String('candidate').pipe(Flag.optional),
    output: outputFlag,
    machine: machineFlag,
    headless: Flag.Boolean('headless').pipe(Flag.withDefault(false)),
    timeout: timeoutFlag,
  },
  Effect.fn('runCommand')(function* ({
    project,
    base,
    candidate,
    output,
    machine,
    headless,
    timeout,
  }) {
    const directory = yield* chooseDirectory(output, 'run');
    const requestedBase = Option.getOrNull(base);
    const exported = yield* runProject({
      projectRoot: path.resolve(project),
      toolRoot,
      directory,
      baseRevision: requestedBase === 'none' ? null : requestedBase,
      candidateRevision: Option.getOrNull(candidate),
      timeoutMs: timeout,
      quiet: machine,
    });
    yield* saveLatest(exported.directory);

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
    project: Argument.String('project'),
    revision: Flag.String('revision').pipe(Flag.optional),
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
    const destination = yield* chooseDirectory(output, 'capture');
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
    base: Argument.String('base-directory-or-none'),
    candidate: Argument.String('candidate-directory'),
    output: outputFlag,
    machine: machineFlag,
  },
  Effect.fn('compareCommand')(function* ({ base, candidate, output, machine }) {
    const directory = yield* chooseDirectory(output, 'comparison');
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
    yield* saveLatest(exported.directory);
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
    directory: Argument.String('report-directory').pipe(Argument.optional),
    port: Flag.Int('port').pipe(
      Flag.withSchema(
        Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 65535 })),
      ),
      Flag.withDefault(4173),
    ),
  },
  Effect.fn('viewCommand')(function* ({ directory, port }) {
    const fs = yield* FileSystem.FileSystem;
    let selected = Option.getOrNull(directory);

    if (selected === null) {
      const latest = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(
          Schema.Struct({ directory: Schema.NonEmptyString }),
        ),
      )(yield* fs.readFileString(path.join(toolRoot, 'evidence/latest.json')));
      selected = latest.directory;
    }

    yield* openViewer(path.resolve(selected), port);
  }),
).pipe(Command.withDescription('View a saved comparison'));

observedVersion(toolRoot).pipe(
  Effect.flatMap((version) =>
    Command.make('observed').pipe(
      Command.withSubcommands([run, capture, compare, view]),
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
  Effect.tapCause((cause) => Console.error(Cause.pretty(cause))),
  BunRuntime.runMain({ disableErrorReporting: true }),
);
