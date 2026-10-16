import { commitSchema, type Observed } from '@observed/judge';
import { Effect, FileSystem, Schema } from 'effect';
import path from 'node:path';
import packageJson from '../package.json' with { type: 'json' };
import { gitEnvironment, processOutput } from './process';

class SourceUnavailable extends Schema.TaggedError<SourceUnavailable>()('SourceUnavailable', {
  reason: Schema.String,
}) {}

export const observedProvenance = Effect.fn('observedProvenance')(function* (options: {
  projectRoot: string;
  transcript: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const here = import.meta.dirname;

  const git = (args: readonly string[], failure: string) =>
    processOutput({
      command: 'git',
      args: ['--no-optional-locks', ...args],
      cwd: here,
      env: gitEnvironment(),
      transcript: options.transcript,
      timeoutMs: 10_000,
    }).pipe(
      Effect.catchTags({
        ProcessFailure: () =>
          Effect.fail(
            new SourceUnavailable({ reason: `${failure}; see observed-transcript.jsonl` }),
          ),
        TimeoutError: () =>
          Effect.fail(new SourceUnavailable({ reason: 'Git did not answer within 10 seconds' })),
        PlatformError: () => Effect.fail(new SourceUnavailable({ reason: 'Git could not run' })),
      }),
    );

  const source = yield* Effect.gen(function* () {
    const root = (yield* git(
      ['rev-parse', '--show-toplevel'],
      "Git found no checkout at Observed's directory",
    )).trim();
    const commit = yield* Schema.decodeUnknownEffect(commitSchema)(
      (yield* git(
        ['rev-parse', '--verify', 'HEAD^{commit}'],
        "Observed's checkout has no HEAD commit",
      )).trim(),
    ).pipe(
      Effect.mapError(
        () => new SourceUnavailable({ reason: 'Git returned a HEAD that is not a commit ID' }),
      ),
    );
    const project = path.relative(
      yield* fs.realPath(root),
      yield* fs.realPath(options.projectRoot),
    );
    const projectInsideObserved =
      project !== '' && !project.startsWith('..') && !path.isAbsolute(project);
    const status = yield* git(
      [
        'status',
        '--porcelain',
        '-z',
        '--untracked-files=no',
        '--',
        root,
        ...(projectInsideObserved ? [`:(exclude,literal)${path.join(root, project)}`] : []),
      ],
      "Git could not report changes in Observed's checkout",
    );

    return { kind: 'git', commit, trackedChanges: status !== '' } as const;
  }).pipe(
    Effect.catchTag('SourceUnavailable', ({ reason }) =>
      Effect.succeed({ kind: 'unavailable', reason } as const),
    ),
    Effect.catchTag('PlatformError', () =>
      Effect.succeed({ kind: 'unavailable', reason: 'A path could not be resolved' } as const),
    ),
  );

  return { version: packageJson.version, source } satisfies Observed;
});
