import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Cause, Console, Effect, FileSystem } from 'effect';
import { Argument, Command } from 'effect/unstable/cli';
import path from 'node:path';
import { observedVersion } from './capture/provenance';
import { inspectEvidence } from './evidence';
import { renderReport } from './report';
import { parseManifestJson } from './schema';

const command = Command.make(
  'report',
  {
    manifest: Argument.String('manifest.json').pipe(
      Argument.withDescription(
        'Version 1 manifest; its directory is the bundle root',
      ),
    ),
    output: Argument.String('new-report.md').pipe(
      Argument.withDescription('New output file in an existing directory'),
    ),
  },
  Effect.fn('generateReport')(function* ({
    manifest: manifestArgument,
    output,
  }) {
    const fs = yield* FileSystem.FileSystem;
    const manifestPath = yield* fs.realPath(manifestArgument);
    const input = yield* fs.readFileString(manifestPath);
    const manifest = yield* parseManifestJson(input);
    const report = yield* inspectEvidence(manifest, path.dirname(manifestPath));

    const outputDirectory = yield* fs.realPath(
      path.dirname(path.resolve(output)),
    );

    const outputPath = path.join(outputDirectory, path.basename(output));

    yield* fs.writeFileString(
      outputPath,
      renderReport(report, outputDirectory),
      { flag: 'wx' },
    );

    yield* Console.log(outputPath);
  }),
).pipe(
  Command.withDescription(
    'Generate a Phase 0 Markdown report from imported evidence. Exit success means the report was written. It does not mean that a check passed.',
  ),
);

observedVersion(path.resolve(import.meta.dirname, '..')).pipe(
  Effect.flatMap((version) =>
    command.pipe(Command.run({ version, renderErrors: false })),
  ),
  Effect.provide(BunServices.layer),
  Effect.tapCause((cause) => Console.error(Cause.pretty(cause))),
  BunRuntime.runMain({ disableErrorReporting: true }),
);
