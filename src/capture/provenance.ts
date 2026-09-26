import { Effect, FileSystem, Schema } from 'effect';
import path from 'node:path';
import { commitSchema, text, type Observed } from './model';
import { gitEnvironment, processOutput } from './process';

const packageSchema = Schema.fromJsonString(
  Schema.Struct({ name: Schema.Literal('observed'), version: text }),
);

class SourceUnavailable extends Schema.TaggedError<SourceUnavailable>()(
  'SourceUnavailable',
  { reason: Schema.String },
) {}

export const observedVersion = Effect.fn('observedVersion')(function* (
  toolRoot: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const { version } = yield* Schema.decodeUnknownEffect(packageSchema)(
    yield* fs.readFileString(path.join(toolRoot, 'package.json')),
  );

  return version;
});

export const observedProvenance = Effect.fn('observedProvenance')(
  function* (options: {
    toolRoot: string;
    projectRoot: string;
    transcript: string;
  }) {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.realPath(options.toolRoot);
    const version = yield* observedVersion(root);
    const project = path.relative(
      root,
      yield* fs.realPath(options.projectRoot),
    );
    const env = gitEnvironment();

    const git = (args: readonly string[], failure: string) =>
      processOutput({
        command: 'git',
        args: ['--no-optional-locks', ...args],
        cwd: root,
        env,
        transcript: options.transcript,
        timeoutMs: 10_000,
      }).pipe(
        Effect.catchTags({
          ProcessFailure: () =>
            Effect.fail(
              new SourceUnavailable({
                reason: `${failure}; see observed-transcript.jsonl`,
              }),
            ),
          TimeoutError: () =>
            Effect.fail(
              new SourceUnavailable({
                reason: 'Git did not answer within 10 seconds',
              }),
            ),
          PlatformError: (error) =>
            error.reason.module === 'ChildProcess'
              ? Effect.fail(
                  new SourceUnavailable({ reason: 'Git could not run' }),
                )
              : Effect.fail(error),
        }),
      );

    const source = yield* Effect.gen(function* () {
      const topLevel = (yield* git(
        ['rev-parse', '--show-toplevel'],
        "Git found no checkout at Observed's directory",
      )).trim();
      const checkout = yield* fs.realPath(topLevel).pipe(
        Effect.mapError(
          () =>
            new SourceUnavailable({
              reason: `Git reported a checkout that cannot be resolved: ${topLevel}`,
            }),
        ),
      );

      if (checkout !== root) {
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
      // An application inside Observed's checkout, such as an example, is the
      // captured source; its edits are not changes to Observed.
      const nested =
        project !== '' &&
        project !== '..' &&
        !project.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(project);
      const status = yield* git(
        [
          'status',
          '--porcelain',
          '-z',
          '--untracked-files=no',
          '--',
          '.',
          ...(nested
            ? [`:(exclude,literal)${project.split(path.sep).join('/')}`]
            : []),
        ],
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
