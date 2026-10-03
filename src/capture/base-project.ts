import { Effect, Schema } from 'effect';
import { commitSchema } from './model';
import { firstLine } from './changed-files';
import { gitEnvironment, processOutput } from './process';
import type { RecipeSources } from '../comparison-model';
import { sha256 } from '../encoding';
import { parseProject } from '../project';

type BaseJourneys = RecipeSources['base'];

// The base revision's journeys, read through Git. A base without a usable
// observed.json is `unusable`, and every candidate check then counts as added.
// `unavailable` means Git could not answer, and every check is then unknown.
export const readBaseJourneys = Effect.fn('readBaseJourneys')(
  function* (options: {
    projectRoot: string;
    baseRevision: string;
    transcript: string;
  }) {
    const git = (args: readonly string[]) =>
      processOutput({
        command: 'git',
        args,
        cwd: options.projectRoot,
        env: gitEnvironment(),
        transcript: options.transcript,
      });
    const commit = yield* Schema.decodeUnknownEffect(commitSchema)(
      (yield* git([
        'rev-parse',
        '--verify',
        '--end-of-options',
        `${options.baseRevision}^{commit}`,
      ])).trim(),
    );
    const prefix = (yield* git(['rev-parse', '--show-prefix'])).trim();
    const file = `${prefix}observed.json`;
    const listed = yield* git([
      'ls-tree',
      '--full-tree',
      '--name-only',
      commit,
      '--',
      file,
    ]);

    if (listed.trim() === '') {
      return {
        kind: 'unusable',
        commit,
        reason: 'The base revision has no observed.json.',
      } satisfies BaseJourneys;
    }

    const content = yield* git(['cat-file', 'blob', `${commit}:${file}`]);

    return yield* parseProject(content, 'observed.json').pipe(
      Effect.map(({ journeys }): BaseJourneys => ({
        kind: 'read',
        commit,
        sha256: sha256(content),
        journeys,
      })),
      Effect.catchTag('ProjectFailure', (error) =>
        Effect.succeed<BaseJourneys>({
          kind: 'unusable',
          commit,
          reason: `The base revision's ${(firstLine(error.message) ?? '').replace(/:$/, '.')}`,
        }),
      ),
    );
  },
  Effect.catchTags({
    ProcessFailure: (error) =>
      Effect.succeed<BaseJourneys>({
        kind: 'unavailable',
        reason: `Git could not read observed.json from the base revision: ${firstLine(error.stderr) ?? error.message}`,
      }),
    PlatformError: (error) =>
      Effect.succeed<BaseJourneys>({
        kind: 'unavailable',
        reason: `Git could not read observed.json from the base revision: ${error.message}`,
      }),
    SchemaError: () =>
      Effect.succeed<BaseJourneys>({
        kind: 'unavailable',
        reason: 'Git returned a base revision that is not a commit ID.',
      }),
  }),
);
