import {
  comparisonSchema,
  resultVersionProblem,
  selectionSchema,
  type Comparison,
  type Selection,
} from '@observed/judge';
import { Data, Effect, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export const evidenceRef = 'refs/observed/evidence';

export const evidenceRefspec = 'refs/observed/*:refs/observed/*';

export class EvidenceStoreError extends Data.TaggedError('EvidenceStoreError')<{
  readonly message: string;
}> {}

type Mode = '100644' | '100755';

export type RecordFile = { readonly path: string; readonly mode: Mode; readonly bytes: Uint8Array };

export type StoredRecord = {
  readonly id: string;
  readonly selection: Selection;
  readonly result: Comparison;
  readonly captures: readonly RecordFile[];
};

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

const fail = (message: string) => Effect.fail(new EvidenceStoreError({ message }));

const git = Effect.fn('git')(
  function* (cwd: string, args: readonly string[], input?: Uint8Array) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const handle = yield* spawner.spawn(
      ChildProcess.make('git', args, {
        cwd,
        stdin: input === undefined ? 'ignore' : Stream.make(input),
        stdout: 'pipe',
        stderr: 'pipe',
      }),
    );
    const [stdout, stderr, code] = yield* Effect.all(
      [Stream.runCollect(handle.stdout), Stream.runCollect(handle.stderr), handle.exitCode],
      { concurrency: 'unbounded' },
    );

    return { code: Number(code), stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
  },
  Effect.scoped,
  Effect.catchTag('PlatformError', (error) => fail(`git could not run: ${error.message}`)),
);

const run = Effect.fn('run')(function* (cwd: string, args: readonly string[], input?: Uint8Array) {
  const output = yield* git(cwd, args, input);

  if (output.code !== 0) {
    return yield* fail(`git ${args[0] ?? ''} failed: ${output.stderr.toString().trim()}`);
  }

  return output.stdout;
});

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function sorted(files: readonly RecordFile[]): RecordFile[] {
  return [...files].sort((a, b) => byCodeUnit(a.path, b.path));
}

function recordId(files: readonly RecordFile[]): string {
  const manifest = sorted(files).map((file) => [file.mode, sha256(file.bytes), file.path]);

  return sha256(encoder.encode(JSON.stringify(manifest)));
}

const resolveCommit = Effect.fn('resolveCommit')(function* (cwd: string, revision: string) {
  const output = yield* git(cwd, [
    'rev-parse',
    '--verify',
    '--end-of-options',
    `${revision}^{commit}`,
  ]);

  if (output.code !== 0) {
    return yield* fail(`${revision} is not a commit in this repository.`);
  }

  return output.stdout.toString().trim();
});

const refTip = Effect.fn('refTip')(function* (cwd: string) {
  const output = yield* git(cwd, ['rev-parse', '--verify', '--quiet', `${evidenceRef}^{commit}`]);

  return output.code === 0 ? output.stdout.toString().trim() : null;
});

async function readCaptures(root: string, relative = ''): Promise<RecordFile[]> {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry): Promise<RecordFile[]> => {
      const name = relative === '' ? entry.name : `${relative}/${entry.name}`;

      if (entry.isDirectory()) {
        return readCaptures(root, name);
      }

      if (!entry.isFile()) {
        throw new Error(`${name} is not a regular file`);
      }

      const absolute = path.join(root, name);
      const [stat, bytes] = await Promise.all([lstat(absolute), readFile(absolute)]);

      return [{ path: name, mode: (stat.mode & 0o111) === 0 ? '100644' : '100755', bytes }];
    }),
  );

  return files.flat();
}

// fast-import's C-style quoting, so any path survives the stream.
function quoted(value: string): string {
  return `"${value.replace(/[\\"\n]/g, (character) => (character === '\n' ? '\\n' : `\\${character}`))}"`;
}

function importStream(options: {
  tip: string | null;
  prefix: string;
  files: readonly RecordFile[];
}): Uint8Array {
  const parts: Uint8Array[] = [];
  const text = (value: string) => parts.push(encoder.encode(value));
  const data = (bytes: Uint8Array) => {
    text(`data ${bytes.length}\n`);
    parts.push(bytes);
    text('\n');
  };

  text(`commit ${evidenceRef}\ncommitter Observed <observed@localhost> now\n`);
  data(encoder.encode(`Record ${options.prefix}\n`));

  if (options.tip !== null) {
    text(`from ${options.tip}\n`);
  }

  for (const file of sorted(options.files)) {
    text(`M ${file.mode} inline ${quoted(`${options.prefix}/${file.path}`)}\n`);
    data(file.bytes);
  }

  text('done\n');

  return Buffer.concat(parts);
}

// Adds one record for `commit`. Nothing touches the working tree or the
// index. Writing the same record again adds nothing.
export const writeRecord = Effect.fn('writeRecord')(function* (options: {
  cwd: string;
  commit: string;
  captures: string;
  selection: Selection;
  result: Comparison;
}) {
  const commit = yield* resolveCommit(options.cwd, options.commit);
  const captured = yield* Effect.tryPromise({
    try: () => readCaptures(options.captures),
    catch: (cause) =>
      new EvidenceStoreError({ message: `Captures could not be read: ${String(cause)}` }),
  });
  const saved = (path: string, value: unknown): RecordFile => ({
    path,
    mode: '100644',
    bytes: encoder.encode(`${JSON.stringify(value, null, 2)}\n`),
  });
  const files: RecordFile[] = [
    saved('selection.json', options.selection),
    saved('result.json', options.result),
    ...captured.map((file) => ({ ...file, path: `captures/${file.path}` })),
  ];
  const id = recordId(files);
  const prefix = `${commit}/${id}`;
  const tip = yield* refTip(options.cwd);

  if (
    tip !== null &&
    (yield* git(options.cwd, ['cat-file', '-e', `${tip}:${prefix}`])).code === 0
  ) {
    return { commit, id, created: false };
  }

  yield* run(
    options.cwd,
    ['fast-import', '--quiet', '--done', '--date-format=now'],
    importStream({ tip, prefix, files }),
  );

  return { commit, id, created: true };
});

const altered = (detail: string) => fail(`The evidence in ${evidenceRef} was altered: ${detail}`);

const appendOnly = Effect.fn('appendOnly')(function* (cwd: string, tip: string) {
  const history = yield* run(cwd, ['rev-list', '--parents', tip]);
  const merge = history
    .toString()
    .split('\n')
    .find((line) => line.split(' ').length > 2);

  if (merge !== undefined) {
    return yield* altered(`commit ${merge.split(' ')[0] ?? ''} merges histories.`);
  }

  const [changed] = (yield* run(
    cwd,
    [
      'diff-tree',
      '--stdin',
      '-r',
      '--no-renames',
      '--no-commit-id',
      '--name-only',
      '--diff-filter=a',
      '-z',
    ],
    history,
  ))
    .toString()
    .split('\0')
    .filter((line) => line !== '');

  if (changed !== undefined) {
    return yield* altered(`a later commit changed or removed ${changed}.`);
  }
});

const blobs = Effect.fn('blobs')(function* (cwd: string, oids: readonly string[]) {
  const unique = [...new Set(oids)];
  const output = yield* run(
    cwd,
    ['cat-file', '--batch'],
    encoder.encode(unique.map((oid) => `${oid}\n`).join('')),
  );
  const contents = new Map<string, Uint8Array>();
  let at = 0;

  for (const oid of unique) {
    const end = output.indexOf(10, at);
    const [found, type, size] = output.subarray(at, end).toString().split(' ');

    if (found !== oid || type !== 'blob' || size === undefined) {
      return yield* altered(`object ${oid} is not a readable blob.`);
    }

    contents.set(oid, output.subarray(end + 1, end + 1 + Number(size)));
    at = end + 1 + Number(size) + 1;
  }

  return contents;
});

const decodeResult = Schema.decodeUnknownEffect(comparisonSchema);
const decodeSelection = Schema.decodeUnknownEffect(selectionSchema);

// Every record for `commit`, oldest evaluation first. A missing ref, a ref
// whose history is not append-only, or a record that no longer matches its
// id fails the read.
export const readRecords = Effect.fn('readRecords')(function* (options: {
  cwd: string;
  commit: string;
}) {
  const commit = yield* resolveCommit(options.cwd, options.commit);
  const tip = yield* refTip(options.cwd);

  if (tip === null) {
    return yield* fail(
      `${evidenceRef} is missing. Fetch it with: git fetch origin '${evidenceRefspec}'`,
    );
  }

  yield* appendOnly(options.cwd, tip);

  const entries = (yield* run(options.cwd, [
    'ls-tree',
    '-r',
    '-z',
    '--full-tree',
    tip,
    '--',
    `${commit}/`,
  ]))
    .toString()
    .split('\0')
    .filter((entry) => entry !== '')
    .map((entry) => {
      const [meta = '', name = ''] = entry.split('\t');
      const [mode = '', type = '', oid = ''] = meta.split(' ');
      const [, id = '', ...rest] = name.split('/');

      return { mode, type, oid, id, path: rest.join('/') };
    });
  const contents = yield* blobs(
    options.cwd,
    entries.map((entry) => entry.oid),
  );
  const ids = [...new Set(entries.map((entry) => entry.id))];
  const records: StoredRecord[] = [];

  for (const id of ids) {
    const files: RecordFile[] = [];

    for (const entry of entries.filter((item) => item.id === id)) {
      const bytes = contents.get(entry.oid);

      if ((entry.mode !== '100644' && entry.mode !== '100755') || bytes === undefined) {
        return yield* altered(`${commit}/${id}/${entry.path} is not a regular file.`);
      }

      files.push({ path: entry.path, mode: entry.mode, bytes });
    }

    if (recordId(files) !== id) {
      return yield* altered(`record ${id} for ${commit} no longer matches its hash.`);
    }

    const unreadable = (name: string, detail: string) =>
      new EvidenceStoreError({
        message: `Record ${id} for ${commit} holds an unreadable ${name}: ${detail}`,
      });
    const parsed = (name: string) => {
      const file = files.find((item) => item.path === name);

      return file === undefined
        ? altered(`record ${id} for ${commit} has no ${name}.`)
        : Effect.try({
            try: (): unknown => JSON.parse(decoder.decode(file.bytes)),
            catch: (cause) => unreadable(name, String(cause)),
          });
    };
    const result = yield* parsed('result.json');
    const versionProblem = resultVersionProblem(result);

    if (versionProblem !== null) {
      return yield* fail(versionProblem);
    }

    records.push({
      id,
      selection: yield* decodeSelection(yield* parsed('selection.json')).pipe(
        Effect.mapError((error) => unreadable('selection.json', error.message)),
      ),
      result: yield* decodeResult(result).pipe(
        Effect.mapError((error) => unreadable('result.json', error.message)),
      ),
      captures: files.flatMap((file) =>
        file.path.startsWith('captures/')
          ? [{ ...file, path: file.path.slice('captures/'.length) }]
          : [],
      ),
    });
  }

  return records.sort(
    (a, b) => byCodeUnit(a.result.evaluatedAt, b.result.evaluatedAt) || byCodeUnit(a.id, b.id),
  );
});
