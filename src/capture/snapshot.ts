import { Effect, FileSystem, Schema, Stream } from 'effect';
import { ChildProcess } from 'effect/unstable/process';
import { readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { json, sha256 } from '../encoding';
import { nodeIo, type EvidenceIoError } from '../node-io';
import { relativePathSchema, type Project } from '../project';
import { sourceSchema, type Source } from './model';
import { processOutput } from './process';

export class SourceFailure extends Schema.TaggedError<SourceFailure>()(
  'SourceFailure',
  { message: Schema.String },
) {}

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
): Effect.fn.Return<string[], EvidenceIoError | SourceFailure> {
  if (excluded(relative) || !included.has(relative)) {
    return [];
  }

  const filename = path.join(root, relative);
  const stat = yield* nodeIo(() => lstat(filename));

  if (stat.isSymbolicLink()) {
    return yield* new SourceFailure({
      message: `Source symlinks are unsupported: ${relative}`,
    });
  }

  if (stat.isFile()) {
    return [relative];
  }

  if (!stat.isDirectory()) {
    return yield* new SourceFailure({
      message: `Source must be a regular file or directory: ${relative}`,
    });
  }

  const entries = yield* nodeIo(() => readdir(filename));
  const files: string[] = [];

  for (const entry of entries) {
    files.push(
      ...(yield* workingFiles(
        root,
        path.posix.join(relative, entry),
        included,
      )),
    );
  }

  return files;
});

const readGitBlob = Effect.fnUntraced(function* (root: string, object: string) {
  const handle = yield* ChildProcess.make('git', ['cat-file', 'blob', object], {
    cwd: root,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'ignore',
  });
  const [code, chunks] = yield* Effect.all(
    [handle.exitCode, Stream.runCollect(handle.stdout)],
    { concurrency: 'unbounded' },
  );

  if (code !== 0) {
    return yield* new SourceFailure({
      message: `Cannot read source blob ${object}`,
    });
  }

  return new Uint8Array(Buffer.concat(chunks));
}, Effect.scoped);

export const snapshotApplication = Effect.fn('snapshotApplication')(
  function* (options: {
    projectRoot: string;
    directory: string;
    source: Project['source'];
    revision: string | null;
  }) {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.realPath(options.projectRoot);
    const records: Source['files'][number][] = [];
    const selected = options.source.paths;
    const files = new Map<
      string,
      { object: string | null; executable: boolean }
    >();
    let revision = 'worktree';

    const git = (args: readonly string[]) =>
      processOutput({
        command: 'git',
        args,
        cwd: root,
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
      const inventory = yield* git(listArguments).pipe(
        Effect.catchTag('ProcessFailure', () =>
          Effect.gen(function* () {
            const emptyGit = yield* fs.makeTempDirectoryScoped({
              prefix: 'observed-index-',
            });
            yield* git(['init', '--bare', '--quiet', emptyGit]);

            return yield* git([
              '--git-dir',
              emptyGit,
              '--work-tree',
              root,
              ...listArguments,
            ]);
          }),
        ),
      );
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
          const ancestor = path.join(root, ...parts.slice(0, index));

          if ((yield* nodeIo(() => lstat(ancestor))).isSymbolicLink()) {
            return yield* new SourceFailure({
              message: `Source symlink ancestor is unsupported: ${entry}`,
            });
          }
        }

        for (const file of yield* workingFiles(root, entry, included)) {
          const stat = yield* nodeIo(() => lstat(path.join(root, file)));
          files.set(file, {
            object: null,
            executable: (stat.mode & 0o111) !== 0,
          });
        }
      }
    } else {
      const commit = (yield* git([
        'rev-parse',
        '--verify',
        '--end-of-options',
        `${options.revision}^{commit}`,
      ])).trim();
      yield* Schema.decodeUnknownEffect(
        Schema.String.check(Schema.isPattern(/^[a-f0-9]{40,64}$/)),
      )(commit);
      revision = commit;
      const prefix = (yield* git(['rev-parse', '--show-prefix'])).trim();
      const tree = yield* git(['ls-tree', '-rz', '--full-tree', commit]);

      for (const entry of tree.split('\0').filter(Boolean)) {
        const match = /^(\d+) (\w+) ([a-f0-9]+)\t(.+)$/s.exec(entry);
        const fullPath = match?.[4];
        const object = match?.[3];

        if (
          fullPath === undefined ||
          object === undefined ||
          !fullPath.startsWith(prefix)
        ) {
          continue;
        }

        const file = fullPath.slice(prefix.length);

        if (
          excluded(file) ||
          !selected.some((item) => file === item || file.startsWith(`${item}/`))
        ) {
          continue;
        }

        if (match?.[1] !== '100644' && match?.[1] !== '100755') {
          return yield* new SourceFailure({
            message: `Unsupported source entry at ${commit}: ${file}`,
          });
        }

        files.set(file, { object, executable: match?.[1] === '100755' });
      }
    }

    if (!files.has(options.source.entry)) {
      return yield* new SourceFailure({
        message: `Source entry ${options.source.entry} is absent or excluded in ${revision}`,
      });
    }

    for (const [file, { object, executable }] of [...files].sort(
      ([left], [right]) => left.localeCompare(right, 'en'),
    )) {
      yield* Schema.decodeUnknownEffect(relativePathSchema)(file);
      const bytes =
        object === null
          ? yield* fs.readFile(path.join(root, file))
          : yield* readGitBlob(root, object);
      const output = path.join(options.directory, 'source', file);

      yield* fs.makeDirectory(path.dirname(output), { recursive: true });
      yield* fs.writeFile(output, bytes, { flag: 'wx' });
      records.push({ path: file, sha256: sha256(bytes), executable });
    }

    records.sort((left, right) =>
      left.path < right.path ? -1 : Number(left.path > right.path),
    );
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
      Effect.fail(
        new SourceFailure({
          message: `${error.message}\n${error.stderr}`.trim(),
        }),
      ),
    EvidenceIoError: (error) =>
      Effect.fail(
        new SourceFailure({
          message: `Source could not be read (${error.code})`,
        }),
      ),
    PlatformError: (error) =>
      Effect.fail(new SourceFailure({ message: error.message })),
    TimeoutError: () =>
      Effect.fail(new SourceFailure({ message: 'Source snapshot timed out' })),
  }),
);
