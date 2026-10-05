import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
  checkRun,
  select,
  type Expectation,
} from '../scripts/gate-corpus/check';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
  roots.length = 0;
});

const expected = {
  id: 'checker-faults',
  gate: 8,
  reason: 'A forged result cannot pass the independent checker.',
  exitCode: 2,
  assertions: [
    {
      label: 'verdict',
      actual: {
        kind: 'json',
        file: 'result.json',
        path: ['conclusion', 'kind'],
      },
      expected: 'regression',
    },
    {
      label: 'request count',
      actual: { kind: 'json', file: 'result.json', path: ['actual'] },
      expected: 2,
      raw: {
        kind: 'requests',
        file: 'requests.har',
        method: 'GET',
        pathname: '/api/items',
        status: 200,
      },
    },
  ],
} satisfies Expectation;

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'observed-gate-checker-'));
  roots.push(root);
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify({ conclusion: { kind: 'regression' }, actual: 2 }),
  );
  await writeFile(
    path.join(root, 'requests.har'),
    JSON.stringify({
      log: {
        entries: [0, 1].map(() => ({
          request: { method: 'GET', url: 'http://localhost:4567/api/items' },
          response: { status: 200 },
        })),
      },
    }),
  );

  return root;
}

test('rejects a forged pass, wrong measurement, and wrong CLI exit independently', async () => {
  const root = await fixture();
  expect((await checkRun(root, expected, 2)).passed).toBe(true);

  for (const result of [
    { conclusion: { kind: 'no-regression' }, actual: 2 },
    { conclusion: { kind: 'regression' }, actual: 1 },
  ]) {
    await writeFile(path.join(root, 'result.json'), JSON.stringify(result));
    expect((await checkRun(root, expected, 2)).passed).toBe(false);
  }

  expect((await checkRun(await fixture(), expected, 0)).passed).toBe(false);
});

test('rejects missing, malformed, or disagreeing raw output even when the result is correct', async () => {
  const root = await fixture();

  for (const raw of ['not JSON', '{}', '{"log":{"entries":[]}}']) {
    await writeFile(path.join(root, 'requests.har'), raw);
    expect((await checkRun(root, expected, 2)).passed).toBe(false);
  }

  await rm(path.join(root, 'requests.har'));
  expect((await checkRun(root, expected, 2)).passed).toBe(false);
});

test('refuses raw artifacts that escape the bundle through a symlink', async () => {
  const root = await fixture();
  const other = await fixture();
  await rm(path.join(root, 'requests.har'));
  await symlink(
    path.join(other, 'requests.har'),
    path.join(root, 'requests.har'),
  );

  expect((await checkRun(root, expected, 2)).failures.join(' ')).toContain(
    'outside the run',
  );
});

test('does not silently choose a duplicate check or treat a missing field as null', () => {
  expect(() =>
    select({ checks: [{ id: 'one' }, { id: 'one' }] }, [
      'checks',
      { key: 'id', equals: 'one' },
    ]),
  ).toThrow('found 2');
  expect(() => select({}, ['missing'])).toThrow('Missing field');
});
