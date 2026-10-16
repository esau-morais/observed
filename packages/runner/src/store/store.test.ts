import { BunServices } from '@effect/platform-bun';
import {
  inspectComparison,
  receipt,
  selectionSchemaVersion,
  type Selection,
} from '@observed/judge';
import {
  evaluatedAt,
  judgedSides,
  projectJourney,
  removeTemporaryDirectories,
  requestCheck,
  temporaryDirectory,
} from '@observed/judge/testing';
import { Effect } from 'effect';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { evidenceRef, evidenceRefspec, readRecords, writeRecord, type StoredRecord } from './store';

afterEach(removeTemporaryDirectories);

const identity = {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@localhost',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@localhost',
};

function git(cwd: string, args: string[], options: { input?: string; index?: string } = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    input: options.input,
    env: {
      ...process.env,
      ...identity,
      ...(options.index === undefined ? {} : { GIT_INDEX_FILE: options.index }),
    },
  }).trim();
}

const provided = <A, E>(effect: Effect.Effect<A, E, BunServices.BunServices>) =>
  effect.pipe(Effect.provide(BunServices.layer));

const read = (cwd: string, commit = 'HEAD') =>
  Effect.runPromise(provided(readRecords({ cwd, commit })));

const readError = (cwd: string) =>
  Effect.runPromise(provided(Effect.flip(readRecords({ cwd, commit: 'HEAD' })))).then(
    (error) => error.message,
  );

async function rejudged(record: StoredRecord) {
  const root = await temporaryDirectory('observed-store-rejudge-');

  for (const file of record.captures) {
    await mkdir(path.dirname(path.join(root, file.path)), { recursive: true });
    await writeFile(path.join(root, file.path), file.bytes);
  }

  const { result } = await Effect.runPromise(
    inspectComparison({ root, selection: record.selection }),
  );

  return receipt(result);
}

async function judgedProject() {
  const repo = await temporaryDirectory('observed-store-repo-');
  git(repo, ['init', '-q']);
  await writeFile(path.join(repo, 'app.txt'), 'app\n');
  git(repo, ['add', 'app.txt']);
  git(repo, ['commit', '-q', '-m', 'app']);

  const allowsTwo = {
    ...requestCheck,
    id: 'at-most-two-requests',
    name: 'Two requests',
    expectedCount: 2,
  };
  const checks = [requestCheck, allowsTwo];
  const bundles = await judgedSides({ captured: checks, baseCount: 2, candidateCount: 2 });
  const captures = await temporaryDirectory('observed-store-captures-');
  await cp(bundles.base.directory, path.join(captures, 'journey-1/base'), { recursive: true });
  await cp(bundles.candidate.directory, path.join(captures, 'journey-1/candidate'), {
    recursive: true,
  });
  const selection: Selection = {
    schemaVersion: selectionSchemaVersion,
    evaluatedAt,
    mode: 'comparison',
    journeys: [{ directory: 'journey-1', base: null, candidate: null }],
    recipes: {
      base: {
        kind: 'read',
        commit: 'c'.repeat(40),
        sha256: 'd'.repeat(64),
        journeys: [projectJourney(checks)],
      },
      candidate: [projectJourney(checks)],
    },
  };
  const { result } = await Effect.runPromise(inspectComparison({ root: captures, selection }));
  const written = await Effect.runPromise(
    provided(writeRecord({ cwd: repo, commit: 'HEAD', captures, selection, result })),
  );

  return { repo, captures, result, written };
}

test('a fresh clone rebuilds the same receipt from the ref alone', async () => {
  const { repo, captures, result } = await judgedProject();
  const expected = receipt(result);

  expect(git(repo, ['status', '--porcelain', '--ignored'])).toBe('');

  const clone = await temporaryDirectory('observed-store-clone-');
  git(clone, ['clone', '-q', repo, '.']);

  expect(await readError(clone)).toContain(`${evidenceRef} is missing`);

  git(clone, ['fetch', '-q', 'origin', evidenceRefspec]);
  await rm(repo, { recursive: true, force: true });
  await rm(captures, { recursive: true, force: true });

  const records = await read(clone);

  expect(expected.split('\n').map((line) => line.trim().split(' ')[0])).toContain('checked');

  expect(records.map((record) => receipt(record.result))).toEqual([expected]);
  expect(await Promise.all(records.map(rejudged))).toEqual([expected]);
});

test('a record changed, removed or rewritten into history is refused, never read', async () => {
  const { repo, written } = await judgedProject();
  const prefix = `${written.commit}/${written.id}`;
  const stored = git(repo, ['show', `${evidenceRef}:${prefix}/result.json`]);
  const forged = stored.replace(/"kind": "check-failed"/g, '"kind": "no-regression"');

  expect(forged).not.toBe(stored);

  const change = (index: string) => {
    const blob = git(repo, ['hash-object', '-w', '--stdin'], { input: forged });
    git(repo, ['update-index', '--cacheinfo', `100644,${blob},${prefix}/result.json`], {
      index,
    });
  };
  const alterations = [
    { name: 'changed in a later commit', alter: change, rewrite: false },
    {
      name: 'removed in a later commit',
      alter: (index: string) => git(repo, ['rm', '-r', '-q', '--cached', prefix], { index }),
      rewrite: false,
    },
    { name: 'changed by rewriting history', alter: change, rewrite: true },
  ];

  for (const { name, alter, rewrite } of alterations) {
    const index = path.join(await temporaryDirectory('observed-store-index-'), 'index');
    git(repo, ['read-tree', evidenceRef], { index });
    alter(index);
    const tree = git(repo, ['write-tree'], { index });
    const tip = git(repo, ['rev-parse', evidenceRef]);
    const parents = rewrite ? [] : ['-p', tip];
    git(repo, [
      'update-ref',
      evidenceRef,
      git(repo, ['commit-tree', tree, ...parents, '-m', name]),
    ]);

    expect(await readError(repo), name).toContain('was altered');

    git(repo, ['update-ref', evidenceRef, tip]);
  }

  expect(await read(repo)).toHaveLength(1);
});
