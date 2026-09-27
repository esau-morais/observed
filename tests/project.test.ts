import { BunServices } from '@effect/platform-bun';
import { Effect, Schema } from 'effect';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import requestLab from '../examples/request-lab/observed.json';
import shop from '../examples/shop/observed.json';
import { loadProject } from '../src/project';
import { checkSchema } from '../src/checks';
import { json } from '../src/encoding';

test.each(['/orders?category=books', '/orders#submitted'])(
  'rejects unsupported request matching syntax %s',
  (route) => {
    expect(() =>
      Schema.decodeUnknownSync(checkSchema)({
        kind: 'request-count',
        id: 'orders',
        name: 'No orders',
        scope: 'One submission',
        method: 'POST',
        path: route,
        expectedCount: 0,
        status: 201,
      }),
    ).toThrow();
  },
);

test.each([
  '?token',
  '?%74oken',
  '?api%5fkey',
  '#/orders?token',
  '#/orders?%74oken',
])('rejects credential-bearing capture path /%s', async (query) => {
  const root = await mkdtemp(path.join(tmpdir(), 'observed-project-'));

  try {
    await writeFile(
      path.join(root, 'observed.json'),
      json({
        ...shop,
        capture: { ...shop.capture, path: `/${query}=sensitive-value` },
      }),
    );
    const result = await Effect.runPromise(
      loadProject(root).pipe(Effect.provide(BunServices.layer), Effect.flip),
    );

    expect(result.message).toContain('credentials');
    expect(result.message).not.toContain('sensitive-value');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function load(config: unknown) {
  const root = await mkdtemp(path.join(tmpdir(), 'observed-project-'));

  try {
    await writeFile(path.join(root, 'observed.json'), json(config));

    return await Effect.runPromise(
      loadProject(root).pipe(
        Effect.map((loaded) => ({ ok: true, loaded }) as const),
        Effect.catchTag('ProjectFailure', (error) =>
          Effect.succeed({ ok: false, message: error.message } as const),
        ),
        Effect.provide(BunServices.layer),
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const statusCheck = {
  kind: 'text',
  id: 'status',
  name: 'Status',
  scope: 'After the order',
  selector: '#status',
  expectedText: 'Placed',
} as const;

test.each([
  {
    name: 'both capture and journeys',
    config: { ...shop, journeys: [shop.capture] },
    message: 'Set either capture',
  },
  {
    name: 'neither capture nor journeys',
    config: { ...shop, capture: undefined },
    message: 'Set either capture',
  },
  {
    name: 'more than three journeys',
    config: {
      ...shop,
      capture: undefined,
      journeys: ['a', 'b', 'c', 'd'].map((name) => ({ ...shop.capture, name })),
    },
    message: 'journeys',
  },
  {
    name: 'duplicate journey names',
    config: {
      ...shop,
      capture: undefined,
      journeys: [shop.capture, shop.capture],
    },
    message: 'Journey names must be unique',
  },
  {
    name: 'both check and checks',
    config: {
      ...requestLab,
      capture: { ...requestLab.capture, checks: [statusCheck] },
    },
    message: 'Set either check or checks',
  },
  {
    name: 'duplicate check IDs',
    config: {
      ...shop,
      capture: {
        ...shop.capture,
        check: undefined,
        checks: [statusCheck, statusCheck],
      },
    },
    message: 'Check IDs must be unique',
  },
])('rejects $name', async ({ config, message }) => {
  const result = await load(config);

  expect(result.ok).toBe(false);
  expect(result.ok ? '' : result.message).toContain(message);
});

test('keeps a single check working and adds the collectors checks need', async () => {
  const single = await load(requestLab);
  const several = await load({
    ...requestLab,
    capture: undefined,
    journeys: [
      { ...requestLab.capture, name: 'Browse' },
      {
        ...requestLab.capture,
        name: 'Order',
        check: undefined,
        checks: [
          requestLab.capture.check,
          statusCheck,
          { ...statusCheck, id: 'total', selector: '#total' },
        ],
      },
    ],
  });

  expect(
    single.ok && single.loaded.recipes.map((recipe) => recipe.checks),
  ).toEqual([[requestLab.capture.check]]);
  expect(
    several.ok &&
      several.loaded.recipes.map((recipe) => ({
        id: recipe.id,
        checks: recipe.checks.map((check) => check.id),
        collectors: recipe.collectors,
      })),
  ).toEqual([
    { id: 'Browse', checks: [requestLab.capture.check.id], collectors: [] },
    {
      id: 'Order',
      checks: [requestLab.capture.check.id, 'status', 'total'],
      collectors: [{ kind: 'text', selectors: ['#status', '#total'] }],
    },
  ]);
});
