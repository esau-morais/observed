import { Effect, FileSystem } from 'effect';
import path from 'node:path';
import type { GitChanges } from '../comparison-model';
import { gitEnvironment, processOutput } from './process';

const changeKinds: Readonly<Record<string, 'added' | 'removed' | 'modified'>> =
  {
    A: 'added',
    D: 'removed',
    M: 'modified',
    T: 'modified',
    U: 'modified',
  };

// Git paths are relative to the repository root; the change scope uses paths
// relative to the project, as source snapshots do.
function projectPath(prefix: string, repositoryPath: string): string {
  return repositoryPath.startsWith(prefix)
    ? repositoryPath.slice(prefix.length)
    : path.posix.relative(prefix, repositoryPath);
}

export function firstLine(value: string): string | null {
  const [line = ''] = value.trim().split('\n');

  return line === '' ? null : line;
}

// Names of files that differ between the base revision and the candidate
// revision, or the working tree with untracked files when there is no
// candidate revision.
export const gitChanges = Effect.fn('gitChanges')(
  function* (options: {
    projectRoot: string;
    baseRevision: string;
    candidateRevision: string | null;
    transcript: string;
  }) {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.realPath(options.projectRoot);
    const git = (args: readonly string[]) =>
      processOutput({
        command: 'git',
        args,
        cwd: root,
        env: gitEnvironment(),
        transcript: options.transcript,
      });
    const prefix = (yield* git(['rev-parse', '--show-prefix'])).trim();
    const diff = yield* git([
      'diff',
      '--name-status',
      '-z',
      '--no-renames',
      // A user's diff.relative setting would drop files outside the project.
      '--no-relative',
      '--end-of-options',
      options.baseRevision,
      ...(options.candidateRevision === null
        ? []
        : [options.candidateRevision]),
      '--',
    ]);
    const files = new Map<string, 'added' | 'removed' | 'modified'>();
    const fields = diff.split('\0');

    for (let index = 0; index + 1 < fields.length; index += 2) {
      const change = changeKinds[fields[index]?.charAt(0) ?? ''];
      const file = fields[index + 1];

      if (change !== undefined && file !== undefined && file !== '') {
        files.set(projectPath(prefix, file), change);
      }
    }

    if (options.candidateRevision === null) {
      const untracked = yield* git([
        'ls-files',
        '--others',
        '--exclude-standard',
        '--full-name',
        '-z',
        '--',
        ':/',
      ]);

      for (const file of untracked.split('\0').filter(Boolean)) {
        files.set(projectPath(prefix, file), 'added');
      }
    }

    return {
      kind: 'listed',
      files: [...files]
        .sort(([left], [right]) => (left < right ? -1 : Number(left > right)))
        .map(([file, change]) => ({ path: file, change })),
    } satisfies GitChanges;
  },
  Effect.catchTags({
    ProcessFailure: (error) =>
      Effect.succeed<GitChanges>({
        kind: 'unavailable',
        reason: `Git could not list the changed files: ${firstLine(error.stderr) ?? error.message}`,
      }),
    PlatformError: (error) =>
      Effect.succeed<GitChanges>({
        kind: 'unavailable',
        reason: `Git could not list the changed files: ${error.message}`,
      }),
  }),
);
