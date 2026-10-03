import { BunServices } from '@effect/platform-bun';
import { Effect, Schema } from 'effect';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { readBaseJourneys } from '../src/capture/base-project';
import { sha256 } from '../src/encoding';
import { journeySchema, type Journey } from '../src/project';
import { recipePlan } from '../src/recipe-diff';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const parseJourney = (text: string): Journey =>
  Schema.decodeUnknownSync(Schema.fromJsonString(journeySchema))(text);

const loadItems = {
  name: 'Load items',
  path: '/',
  ready: [{ kind: 'wait-text', text: 'Load items' }],
  steps: [
    { kind: 'click-role', role: 'button', name: 'Load items' },
    { kind: 'network-idle' },
  ],
  check: {
    kind: 'request-count',
    id: 'one-items-request',
    name: 'One request per load action',
    scope: 'One Load items click.',
    method: 'GET',
    path: '/api/items',
    expectedCount: 1,
    status: 200,
  },
};

const journey = (value: unknown): Journey =>
  parseJourney(JSON.stringify(value));

const provenance = {
  kind: 'read',
  commit: 'c'.repeat(40),
  sha256: 'd'.repeat(64),
} as const;

const read = (...journeys: [Journey, ...Journey[]]) =>
  ({ ...provenance, journeys }) as const;

test('key order, whitespace, check versus checks, and omitted defaults are not differences', () => {
  const base = parseJourney(JSON.stringify(loadItems));
  const reordered = parseJourney(`{
    "check": {
      "status": 200, "expectedCount": 1, "path": "/api/items", "method": "GET",
      "scope": "One Load items click.", "name": "One request per load action",
      "id": "one-items-request", "kind": "request-count"
    },
    "steps": [
      { "name": "Load items", "role": "button", "kind": "click-role" },
      { "kind": "network-idle" }
    ],
    "ready": [{ "text": "Load items", "kind": "wait-text" }],
    "path": "/",
    "name": "Load items"
  }`);
  const explicit = journey({
    ...loadItems,
    check: undefined,
    checks: [loadItems.check],
    viewport: { width: 1280, height: 800, scale: 1 },
    browserArguments: [],
    maxAgeMs: 86_400_000,
  });

  for (const candidate of [reordered, explicit]) {
    expect(
      recipePlan({ base: read(base), candidate: [candidate] }, 'unused').scope,
    ).toEqual({ kind: 'unchanged', base: provenance });
  }
});

test('an altered expectation keeps both values and the base definition', () => {
  const base = journey(loadItems);
  const candidate = journey({
    ...loadItems,
    check: { ...loadItems.check, expectedCount: 2 },
  });
  const plan = recipePlan(
    { base: read(base), candidate: [candidate] },
    'unused',
  );

  expect(plan.scope).toEqual({
    kind: 'changed',
    base: provenance,
    differences: [
      {
        journey: 'Load items',
        check: 'one-items-request',
        change: 'altered',
        fields: [{ field: 'expectedCount', base: 1, candidate: 2 }],
      },
    ],
  });
  expect(plan.judge('Load items')).toEqual({
    kind: 'compared',
    base: [loadItems.check],
    fields: [],
  });
});

test('added, removed and altered journeys and checks are each listed', () => {
  const extra = {
    ...loadItems.check,
    id: 'no-other-request',
    name: 'No other request',
    path: '/api/other',
    expectedCount: 0,
  };
  const base = [
    journey({ ...loadItems, check: undefined, checks: [loadItems.check] }),
    journey({ ...loadItems, name: 'Old journey' }),
  ] as const;
  const candidate = [
    journey({
      ...loadItems,
      steps: [{ kind: 'click-role', role: 'button', name: 'Load items' }],
      check: undefined,
      checks: [extra],
    }),
    journey({ ...loadItems, name: 'New journey' }),
  ] as const;
  const plan = recipePlan(
    { base: read(...base), candidate: [...candidate] },
    'unused',
  );

  expect(plan.scope).toEqual({
    kind: 'changed',
    base: provenance,
    differences: [
      {
        journey: 'Load items',
        change: 'altered',
        fields: [
          {
            field: 'steps',
            base: loadItems.steps,
            candidate: [loadItems.steps[0]],
          },
        ],
      },
      { journey: 'Load items', check: 'no-other-request', change: 'added' },
      { journey: 'Load items', check: 'one-items-request', change: 'removed' },
      { journey: 'New journey', change: 'added' },
      { journey: 'Old journey', change: 'removed' },
    ],
  });
  expect(plan.judge('Load items')).toMatchObject({ fields: ['steps'] });
  expect(plan.judge('New journey')).toEqual({ kind: 'added' });
  expect(plan.removed).toEqual([
    { journey: 'Old journey', checks: [loadItems.check], imports: false },
  ]);
});

test('an unusable base file makes every candidate journey added, an unreadable one leaves checks unknown, and none compares nothing', () => {
  const candidate = journey(loadItems);
  const unusable = recipePlan(
    {
      base: {
        kind: 'unusable',
        commit: 'c'.repeat(40),
        reason: 'The base revision has no observed.json.',
      },
      candidate: [candidate],
    },
    'unused',
  );

  expect(unusable.scope).toEqual({
    kind: 'changed',
    base: {
      kind: 'unusable',
      commit: 'c'.repeat(40),
      reason: 'The base revision has no observed.json.',
    },
    differences: [{ journey: 'Load items', change: 'added' }],
  });
  expect(unusable.judge('Load items')).toEqual({ kind: 'added' });

  const unreadable = recipePlan(
    {
      base: { kind: 'unavailable', reason: 'Git failed.' },
      candidate: [candidate],
    },
    'unused',
  );

  expect(unreadable.scope).toEqual({
    kind: 'unavailable',
    reason: 'Git failed.',
  });
  expect(unreadable.judge('Load items')).toEqual({
    kind: 'unreadable',
    reason: 'Git failed.',
  });

  const missing = recipePlan(undefined, 'Made from capture directories');

  expect(missing.scope).toEqual({
    kind: 'unavailable',
    reason: 'Made from capture directories',
  });
  expect(missing.judge('Load items')).toEqual({ kind: 'not-compared' });
});

test('the base observed.json is read from Git at the base revision, relative to the project', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'observed-recipe-'));
  directories.push(root);
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString();
  const commit = (message: string) => {
    git('add', '-A');
    git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', message);

    return git('rev-parse', 'HEAD').trim();
  };

  const project = {
    schemaVersion: 1,
    name: 'App',
    source: { entry: 'app.ts', paths: ['app.ts'] },
    setup: [],
    start: ['bun', 'app.ts'],
    ready: { path: '/', status: 200 },
    capture: loadItems,
  };
  const file = path.join(root, 'app/observed.json');

  git('init', '--quiet');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  await mkdir(path.join(root, 'app'));
  await writeFile(path.join(root, 'app/app.ts'), 'one\n');
  const missing = commit('no observed.json');
  await writeFile(file, '{ "schemaVersion": 1 }');
  const invalid = commit('invalid observed.json');
  await writeFile(file, JSON.stringify(project, null, 2));
  const valid = commit('observed.json');
  // The working tree differs from every commit, so a result that matches a
  // commit came from Git.
  await writeFile(file, 'not JSON');

  const transcripts = await mkdtemp(path.join(tmpdir(), 'observed-recipe-'));
  directories.push(transcripts);
  const readAt = (baseRevision: string) =>
    Effect.runPromise(
      readBaseJourneys({
        projectRoot: path.join(root, 'app'),
        baseRevision,
        transcript: path.join(transcripts, 'base.jsonl'),
      }).pipe(Effect.provide(BunServices.layer)),
    );

  expect(await readAt(valid)).toEqual({
    kind: 'read',
    commit: valid,
    sha256: sha256(JSON.stringify(project, null, 2)),
    journeys: [journey(loadItems)],
  });
  expect(await readAt(missing)).toEqual({
    kind: 'unusable',
    commit: missing,
    reason: 'The base revision has no observed.json.',
  });
  expect(await readAt(invalid)).toEqual({
    kind: 'unusable',
    commit: invalid,
    reason:
      "The base revision's observed.json does not match the project contract.",
  });
  expect(await readAt('no-such-revision')).toMatchObject({
    kind: 'unavailable',
  });
});
