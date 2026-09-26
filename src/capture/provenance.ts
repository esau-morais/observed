import { Effect, FileSystem, Schema } from 'effect';
import path from 'node:path';
import { commitSchema, text, type Observed } from './model';
import { processOutput } from './process';

const packageSchema = Schema.fromJsonString(
  Schema.Struct({ name: Schema.Literal('observed'), version: text }),
);

class SourceUnavailable extends Schema.TaggedError<SourceUnavailable>()(
  'SourceUnavailable',
  { reason: Schema.String },
) {}

export const observedProvenance = Effect.fn('observedProvenance')(
  function* (options: { toolRoot: string; transcript: string }) {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.realPath(options.toolRoot);
    const { version } = yield* Schema.decodeUnknownEffect(packageSchema)(
      yield* fs.readFileString(path.join(root, 'package.json')),
    );

    const git = (args: readonly string[], reason: string) =>
      processOutput({
        command: 'git',
        args: ['--no-optional-locks', ...args],
        cwd: root,
        // Inherited GIT_DIR or GIT_WORK_TREE, as set inside a Git hook, would
        // describe the calling repository instead of Observed's checkout.
        env: { PATH: process.env.PATH, HOME: process.env.HOME },
        transcript: options.transcript,
        timeoutMs: 10_000,
      }).pipe(Effect.mapError(() => new SourceUnavailable({ reason })));

    const source = yield* Effect.gen(function* () {
      const topLevel = (yield* git(
        ['rev-parse', '--show-toplevel'],
        "Git found no checkout at Observed's directory",
      )).trim();

      if ((yield* fs.realPath(topLevel)) !== root) {
        return yield* new SourceUnavailable({
          reason:
            "Observed's directory is inside another Git checkout, not its own",
        });
      }

      const commit = yield* Schema.decodeUnknownEffect(commitSchema)(
        (yield* git(
          ['rev-parse', '--verify', 'HEAD^{commit}'],
          "Observed's checkout has no HEAD commit",
        )).trim(),
      );
      const status = yield* git(
        ['status', '--porcelain', '-z', '--untracked-files=no'],
        "Git could not report changes in Observed's checkout",
      );

      return { kind: 'git', commit, trackedChanges: status !== '' } as const;
    }).pipe(
      Effect.catchTag('SourceUnavailable', ({ reason }) =>
        Effect.succeed({ kind: 'unavailable', reason } as const),
      ),
    );

    return { version, source } satisfies Observed;
  },
);
