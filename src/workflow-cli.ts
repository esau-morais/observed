import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Cause, Console, Effect, FileSystem, Option, Schema } from 'effect';
import { Argument, Command, Flag } from 'effect/unstable/cli';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { startApplication } from './capture/application';
import { captureApplication } from './capture/coordinator';
import { processOutput } from './capture/process';
import { json } from './capture/recipe';
import { snapshotApplication } from './capture/snapshot';
import { exportComparison } from './export';
import { serveReport } from './view';

const projectRoot = path.resolve(import.meta.dirname, '..');
const outputFlag = Flag.String('output').pipe(Flag.optional);
const machineFlag = Flag.Boolean('json').pipe(Flag.withDefault(false));

const variantArgument = Argument.Literals('variant', [
  'base',
  'duplicate',
  'visual',
]).pipe(Argument.withDefault('base'));

const chooseDirectory = Effect.fn('chooseDirectory')(function* (
  output: Option.Option<string>,
  prefix: string,
) {
  const fs = yield* FileSystem.FileSystem;

  const directory = path.resolve(
    Option.getOrElse(output, () =>
      path.join(projectRoot, 'evidence', `${prefix}-${randomUUID()}`),
    ),
  );

  yield* fs.makeDirectory(path.dirname(directory), { recursive: true });

  return directory;
});

const buildViewer = Effect.fn('buildViewer')(function* () {
  const fs = yield* FileSystem.FileSystem;

  yield* fs.makeDirectory(path.join(projectRoot, 'evidence'), {
    recursive: true,
  });

  yield* processOutput({
    command: process.execPath,
    args: [path.join(projectRoot, 'node_modules/vite/bin/vite.js'), 'build'],
    cwd: projectRoot,
    transcript: path.join(
      projectRoot,
      'evidence',
      `viewer-build-${randomUUID()}.jsonl`,
    ),
    timeoutMs: 60_000,
  });
});

const saveLatest = Effect.fn('saveLatest')(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;

  yield* fs.makeDirectory(path.join(projectRoot, 'evidence'), {
    recursive: true,
  });

  yield* fs.writeFileString(
    path.join(projectRoot, 'evidence/latest.json'),
    json({ directory }),
  );
});

const capture = Command.make(
  'capture',
  {
    variant: variantArgument,
    output: outputFlag,
    machine: machineFlag,
    timeout: Flag.Int('timeout').pipe(
      Flag.withSchema(Schema.Int.check(Schema.isGreaterThan(0))),
      Flag.withDefault(120_000),
    ),
    stall: Flag.Boolean('stall').pipe(
      Flag.withDescription(
        'Controlled failure reproduction: leave the items response pending',
      ),
      Flag.withDefault(false),
    ),
  },
  Effect.fn('captureCommand')(function* ({
    variant,
    output,
    machine,
    timeout,
    stall,
  }) {
    const directory = yield* chooseDirectory(output, 'capture');

    const result = yield* captureApplication({
      projectRoot,
      directory,
      variant,
      timeoutMs: timeout,
      stall,
    });

    if (machine) {
      yield* Console.log(json(result));
    } else {
      yield* Console.log(
        `Capture ${result.manifest.execution.kind}: ${directory}\nSource snapshot: ${result.manifest.source.sha256}`,
      );
    }

    if (result.manifest.execution.kind === 'failed') {
      process.exitCode = 1;
    }
  }),
).pipe(
  Command.withDescription(
    'Run the saved request journey against an identified fixture source snapshot',
  ),
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

    yield* buildViewer();

    const exported = yield* exportComparison({
      baseDirectory: base === 'none' ? null : path.resolve(base),
      candidateDirectory: path.resolve(candidate),
      directory,
      projectRoot,
    });

    yield* saveLatest(directory);

    if (machine) {
      yield* Console.log(json(exported));
    } else {
      yield* Console.log(
        `${exported.result.conclusion.text}\nReport: ${directory}/report.md\nOpen: bun run view`,
      );
    }
  }),
).pipe(
  Command.withDescription(
    'Check captured requests and export a portable comparison; use none for a missing baseline',
  ),
);

const demo = Command.make(
  'demo',
  {
    output: outputFlag,
    machine: machineFlag,
  },
  Effect.fn('demoCommand')(function* ({ output, machine }) {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* chooseDirectory(output, 'demo');

    yield* fs.makeDirectory(directory);

    yield* fs.makeDirectory(path.join(directory, 'captures'));

    yield* fs.makeDirectory(path.join(directory, 'reports'));

    const cases = [
      { name: 'base', variant: 'base' },
      { name: 'unchanged', variant: 'base' },
      { name: 'duplicate', variant: 'duplicate' },
      { name: 'visual', variant: 'visual' },
    ] as const;

    for (const item of cases) {
      const captured = yield* captureApplication({
        projectRoot,
        directory: path.join(directory, 'captures', item.name),
        variant: item.variant,
      });

      if (!machine) {
        yield* Console.log(
          `${item.name}: capture ${captured.manifest.execution.kind}`,
        );
      }

      if (captured.manifest.execution.kind === 'failed') {
        process.exitCode = 1;
      }
    }

    yield* buildViewer();

    const results = [];

    for (const name of [
      'unchanged',
      'duplicate',
      'visual',
      'missing-baseline',
    ] as const) {
      const reportDirectory = path.join(directory, 'reports', name);

      const exported = yield* exportComparison({
        baseDirectory:
          name === 'missing-baseline'
            ? null
            : path.join(directory, 'captures/base'),
        candidateDirectory: path.join(
          directory,
          'captures',
          name === 'missing-baseline' ? 'unchanged' : name,
        ),
        directory: reportDirectory,
        projectRoot,
      });

      results.push({
        name,
        directory: reportDirectory,
        conclusion: exported.result.conclusion,
        comparison: exported.result.comparison.kind,
      });
    }

    yield* saveLatest(path.join(directory, 'reports/duplicate'));

    if (machine) {
      yield* Console.log(json({ directory, results }));
    } else {
      for (const result of results) {
        yield* Console.log(`${result.name}: ${result.conclusion.text}`);
      }

      yield* Console.log(
        `\nEvidence: ${directory}\nOpen the duplicate-request report: bun run view\nThe developer-adoption gate remains unverified.`,
      );
    }
  }),
).pipe(
  Command.withDescription(
    'Capture base, unchanged, duplicate-request, and visual variants; generate four reports',
  ),
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
    let selected: string;

    if (Option.isSome(directory)) {
      selected = path.resolve(directory.value);
    } else {
      const latest = yield* fs.readFileString(
        path.join(projectRoot, 'evidence/latest.json'),
      );

      const parsed = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(
          Schema.Struct({ directory: Schema.NonEmptyString }),
        ),
      )(latest);

      selected = parsed.directory;
    }

    const url = yield* serveReport({ directory: selected, port });

    yield* Console.log(
      `Observed: ${String(url)}\nReport: ${selected}\nPress Ctrl+C to stop.`,
    );

    yield* Effect.never;
  }),
).pipe(
  Command.withDescription(
    'Open the latest comparison locally, or supply a portable report directory',
  ),
);

const app = Command.make(
  'app',
  {
    variant: variantArgument,
  },
  Effect.fn('appCommand')(function* ({ variant }) {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* chooseDirectory(Option.none(), 'application');

    yield* fs.makeDirectory(directory);

    yield* snapshotApplication({ projectRoot, directory, variant });

    yield* processOutput({
      command: process.execPath,
      args: [
        path.join(projectRoot, 'src/capture/fixture-build.ts'),
        path.join(directory, 'source/fixtures/request-lab'),
        path.join(directory, 'app'),
        variant,
        path.join(projectRoot, 'node_modules'),
      ],
      cwd: projectRoot,
      transcript: path.join(directory, 'transcript.jsonl'),
    });

    const url = yield* startApplication({
      directory: path.join(directory, 'app'),
      evidenceDirectory: directory,
    });

    yield* Console.log(
      `Request lab (${variant}): ${url}\nPress Ctrl+C to stop.`,
    );

    yield* Effect.never;
  }),
).pipe(
  Command.withDescription(
    'Run a controlled application variant for manual inspection',
  ),
);

Command.make('observed').pipe(
  Command.withSubcommands([app, capture, compare, demo, view]),
  Command.run({ version: '0.2.0', renderErrors: false }),
  Effect.scoped,
  Effect.provide(BunServices.layer),
  Effect.tapCause((cause) => Console.error(Cause.pretty(cause))),
  BunRuntime.runMain({ disableErrorReporting: true }),
);
