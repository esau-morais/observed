import {
  commitSchema,
  json,
  relativePathSchema,
  sha256,
  sourceSchema,
  type Source,
} from '@observed/judge';
import { Effect, FileSystem, Schema, Stream } from 'effect';
import { ChildProcess } from 'effect/process';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { gitEnvironment, processOutput } from './process';
import type { Project } from './project';

export class SourceFailure extends Schema.TaggedError<SourceFailure>()('SourceFailure', {
  message: Schema.String,
}) {}

const read = <A>(operation: () => Promise<A>, relative: string) =>
  Effect.tryPromise({
    try: operation,
    catch: () => new SourceFailure({ message: `Source could not be read: ${relative}` }),
  });

function excluded(filename: string): boolean {
  return filename
    .split('/')
    .some(
      (part) =>
        [
          '.git',
          'node_modules',
          'dist',
          'build',
          '.observed',
          'evidence',
          '.ssh',
          '.aws',
          '.npmrc',
          '.netrc',
        ].includes(part) ||
        /^\.env(?:\.|$)/i.test(part) ||
        /\.(?:pem|key|p12|pfx)$/i.test(part),
    );
}

const workingFiles = Effect.fnUntraced(function* (
  root: string,
  relative: string,
  included: ReadonlySet<string>,
): Effect.fn.Return<string[], SourceFailure> {
  if (excluded(relative) || !included.has(relative)) {
    return [];
  }

  const filename = path.join(root, relative);
  const stat = yield* read(() => lstat(filename), relative);

  if (stat.isSymbolicLink()) {
    return yield* new SourceFailure({ message: `Source symlinks are unsupported: ${relative}` });
  }

  if (stat.isFile()) {
    return [relative];
  }

  if (!stat.isDirectory()) {
    return yield* new SourceFailure({
      message: `Source must be a regular file or directory: ${relative}`,
    });
  }

  const files: string[] = [];

  for (const entry of yield* read(() => readdir(filename), relative)) {
    files.push(...(yield* workingFiles(root, path.posix.join(relative, entry), included)));
  }

  return files;
});

const readGitBlob = Effect.fnUntraced(function* ({
  root,
  object,
}: {
  root: string;
  object: string;
}) {
  const handle = yield* ChildProcess.make('git', ['cat-file', 'blob', object], {
    cwd: root,
    env: gitEnvironment(),
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'ignore',
  });
  const [code, chunks] = yield* Effect.all([handle.exitCode, Stream.runCollect(handle.stdout)], {
    concurrency: 'unbounded',
  });

  if (code !== 0) {
    return yield* new SourceFailure({ message: `Cannot read source blob ${object}` });
  }

  return new Uint8Array(Buffer.concat(chunks));
}, Effect.scoped);

export const snapshotSource = Effect.fn('snapshotSource')(
  function* (options: {
    projectRoot: string;
    directory: string;
    source: Project['source'];
    revision: string | null;
  }) {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.realPath(options.projectRoot);
    const selected = options.source.paths;
    const files = new Map<string, { object: string | null; executable: boolean }>();
    let label = 'worktree';
    let revision: Source['revision'];

    const git = (args: readonly string[]) =>
      processOutput({
        command: 'git',
        args,
        cwd: root,
        env: gitEnvironment(),
        transcript: path.join(options.directory, 'source-transcript.jsonl'),
      });

    if (options.revision === null) {
      const listArguments = [
        'ls-files',
        '--cached',
        '--others',
        '--exclude-standard',
        '-z',
        '--',
        '.',
      ];
      const { inventory, tracked } = yield* git(listArguments).pipe(
        Effect.map((output) => ({ inventory: output, tracked: true })),
        Effect.catchTag('ProcessFailure', () =>
          Effect.gen(function* () {
            const emptyGit = yield* fs.makeTempDirectoryScoped({ prefix: 'observed-index-' });
            yield* git(['init', '--bare', '--quiet', emptyGit]);

            return {
              inventory: yield* git(['--git-dir', emptyGit, '--work-tree', root, ...listArguments]),
              tracked: false,
            };
          }),
        ),
      );
      revision = {
        kind: 'worktree',
        head: tracked
          ? yield* git(['rev-parse', '--verify', 'HEAD^{commit}']).pipe(
              Effect.flatMap((output) => Schema.decodeUnknownEffect(commitSchema)(output.trim())),
              Effect.map((commit) => ({ kind: 'commit', commit }) as const),
              Effect.catchTag('ProcessFailure', () =>
                Effect.succeed({
                  kind: 'unavailable',
                  reason: 'The Git repository has no HEAD commit',
                } as const),
              ),
            )
          : {
              kind: 'unavailable',
              reason: 'Git did not list the project as a work tree; see source-transcript.jsonl',
            },
      };
      const included = new Set(
        inventory
          .split('\0')
          .filter((file) => file !== '')
          .flatMap((file) => {
            const parts = file.split('/');

            return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
          }),
      );

      for (const entry of selected) {
        const parts = entry.split('/');

        for (let index = 1; index < parts.length; index++) {
          const ancestor = parts.slice(0, index).join('/');

          if ((yield* read(() => lstat(path.join(root, ancestor)), ancestor)).isSymbolicLink()) {
            return yield* new SourceFailure({
              message: `Source symlink ancestor is unsupported: ${entry}`,
            });
          }
        }

        for (const file of yield* workingFiles(root, entry, included)) {
          const stat = yield* read(() => lstat(path.join(root, file)), file);
          files.set(file, { object: null, executable: (stat.mode & 0o111) !== 0 });
        }
      }
    } else {
      const commit = (yield* git([
        'rev-parse',
        '--verify',
        '--end-of-options',
        `${options.revision}^{commit}`,
      ])).trim();
      yield* Schema.decodeUnknownEffect(commitSchema)(commit);
      label = commit;
      revision = { kind: 'commit', commit };
      const prefix = (yield* git(['rev-parse', '--show-prefix'])).trim();
      const tree = yield* git(['ls-tree', '-rz', '--full-tree', commit]);

      for (const entry of tree.split('\0').filter(Boolean)) {
        const match = /^(\d+) (\w+) ([a-f0-9]+)\t(.+)$/s.exec(entry);
        const mode = match?.[1];
        const object = match?.[3];
        const fullPath = match?.[4];

        if (fullPath === undefined || object === undefined || !fullPath.startsWith(prefix)) {
          continue;
        }

        const file = fullPath.slice(prefix.length);

        if (
          excluded(file) ||
          !selected.some((item) => file === item || file.startsWith(`${item}/`))
        ) {
          continue;
        }

        if (mode !== '100644' && mode !== '100755') {
          return yield* new SourceFailure({
            message: `Unsupported source entry at ${commit}: ${file}`,
          });
        }

        files.set(file, { object, executable: mode === '100755' });
      }
    }

    if (!files.has(options.source.entry)) {
      return yield* new SourceFailure({
        message: `Source entry ${options.source.entry} is absent or excluded in ${label}`,
      });
    }

    const records: Source['files'][number][] = [];

    for (const [file, { object, executable }] of files) {
      yield* Schema.decodeUnknownEffect(relativePathSchema)(file);
      const bytes =
        object === null
          ? yield* fs.readFile(path.join(root, file))
          : yield* readGitBlob({ root, object });
      const output = path.join(options.directory, 'source', file);

      yield* fs.makeDirectory(path.dirname(output), { recursive: true });
      yield* fs.writeFile(output, bytes, { flag: 'wx' });
      records.push({ path: file, sha256: sha256(bytes), executable });
    }

    records.sort((left, right) => (left.path < right.path ? -1 : Number(left.path > right.path)));
    const identity = { entry: options.source.entry, files: records };

    return yield* Schema.decodeUnknownEffect(sourceSchema)({
      kind: 'snapshot',
      sha256: sha256(json(identity)),
      revision,
      ...identity,
    });
  },
  Effect.scoped,
  Effect.timeout('30 seconds'),
  Effect.catchTags({
    ProcessFailure: (error) =>
      Effect.fail(new SourceFailure({ message: `${error.message}\n${error.stderr}`.trim() })),
    PlatformError: (error) => Effect.fail(new SourceFailure({ message: error.message })),
    SchemaError: (error) => Effect.fail(new SourceFailure({ message: error.message })),
    TimeoutError: () => Effect.fail(new SourceFailure({ message: 'Source snapshot timed out' })),
  }),
);
