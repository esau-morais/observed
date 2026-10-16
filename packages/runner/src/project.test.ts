import { BunServices } from '@effect/platform-bun';
import { json } from '@observed/judge';
import { Effect } from 'effect';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import requestLab from '../fixtures/request-lab/observed.json' with { type: 'json' };
import { loadProject, loadProjectAt, readBaseJourneys } from './project';

const directories: string[] = [];
const [loadItems, heading] = requestLab.journeys;

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function directoryWith(config: unknown) {
  const root = await mkdtemp(path.join(tmpdir(), 'observed-project-'));
  directories.push(root);
  await writeFile(path.join(root, 'observed.json'), json(config));

  return root;
}

const load = async (config: unknown) =>
  Effect.runPromise(
    loadProject(await directoryWith(config)).pipe(
      Effect.map((loaded) => ({ ok: true, loaded }) as const),
      Effect.catchTag('ProjectFailure', (error) =>
        Effect.succeed({ ok: false, message: error.message } as const),
      ),
      Effect.provide(BunServices.layer),
    ),
  );

test.each([
  {
    name: 'both capture and journeys',
    config: { ...requestLab, capture: loadItems },
    message: 'Set either capture',
  },
  {
    name: 'neither capture nor journeys',
    config: { ...requestLab, journeys: undefined },
    message: 'Set either capture',
  },
  {
    name: 'more than three journeys',
    config: {
      ...requestLab,
      journeys: ['a', 'b', 'c', 'd'].map((name) => ({ ...heading, name })),
    },
    message: 'journeys',
  },
  {
    name: 'duplicate journey names',
    config: { ...requestLab, journeys: [heading, heading] },
    message: 'Journey names must be unique',
  },
  {
    name: 'both check and checks',
    config: { ...requestLab, journeys: [{ ...heading, checks: [heading?.check] }] },
    message: 'Set either check or checks',
  },
  {
    name: 'a credential in a journey path',
    config: { ...requestLab, journeys: [{ ...heading, path: '/?token=sensitive-value' }] },
    message: 'contains credentials',
  },
])('rejects $name', async ({ config, message }) => {
  const result = await load(config);

  expect(result.ok ? '' : result.message).toContain(message);
  expect(result.ok ? '' : result.message).not.toContain('sensitive-value');
});

test('adds the default collectors and the collectors checks need', async () => {
  const result = await load(requestLab);

  expect(
    result.ok &&
      result.loaded.recipes.map((recipe) => recipe.collectors.map((collector) => collector.kind)),
  ).toEqual([
    ['accessibility', 'timeline', 'browser-errors', 'coverage'],
    ['accessibility', 'timeline', 'browser-errors', 'text', 'coverage'],
  ]);
});

test('reads observed.json at a commit through Git for the base and the candidate, never from the working tree', async () => {
  const root = await directoryWith(requestLab);
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], {
      cwd: root,
      encoding: 'utf8',
      env: Object.fromEntries(
        Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
      ),
    }).trim();
  const at = (revision: string) =>
    Effect.runPromise(
      loadProjectAt({
        projectRoot: root,
        revision,
        transcript: path.join(root, 'transcript.jsonl'),
      }).pipe(
        Effect.map(({ journeys }) => ({ names: journeys.map((journey) => journey.name) })),
        Effect.catchTags({
          ProjectUnreadable: ({ message }) => Effect.succeed({ unreadable: message }),
          ProjectFailure: ({ problem }) => Effect.succeed({ unusable: problem }),
        }),
        Effect.provide(BunServices.layer),
      ),
    );
  const base = (revision: string) =>
    Effect.runPromise(
      readBaseJourneys({
        projectRoot: root,
        baseRevision: revision,
        transcript: path.join(root, 'transcript.jsonl'),
      }).pipe(Effect.provide(BunServices.layer)),
    );

  git('init', '--quiet');
  git('commit', '--quiet', '--allow-empty', '-m', 'empty');
  const empty = git('rev-parse', 'HEAD');
  git('add', 'observed.json');
  git('commit', '--quiet', '-m', 'journeys');
  const configured = git('rev-parse', 'HEAD');
  await writeFile(path.join(root, 'observed.json'), '{ not json');
  git('commit', '--quiet', '-am', 'broken');
  const broken = git('rev-parse', 'HEAD');
  await writeFile(path.join(root, 'observed.json'), json({ ...requestLab, journeys: [heading] }));

  expect(await base(empty)).toEqual({
    kind: 'unusable',
    commit: empty,
    reason: 'The base revision has no observed.json.',
  });
  expect(await base(configured)).toMatchObject({
    kind: 'read',
    commit: configured,
    journeys: [{ name: 'Load items' }, { name: 'Heading' }],
  });
  expect(await at(configured)).toEqual({ names: ['Load items', 'Heading'] });
  expect(await at(broken)).toEqual({ unusable: 'json' });
  expect(await at(empty)).toEqual({ unreadable: `${empty} has no observed.json` });
});
