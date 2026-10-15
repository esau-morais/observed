import { Schema } from 'effect';
import { expect, test } from 'vitest';
import { checkSchema } from './checks';
import { journeyRecipe, savedJourneySchema } from './journey';
import { recipeSchema } from './recipe';

// The journey of examples/request-lab on the legacy branch.
const requestLab = {
  name: 'Load items',
  path: '/',
  ready: [{ kind: 'wait-text', text: 'Load items' }, { kind: 'network-idle' }],
  steps: [
    { kind: 'click-role', role: 'button', name: 'Load items' },
    { kind: 'wait-text', text: 'Items loaded' },
    { kind: 'network-idle' },
  ],
  check: {
    kind: 'request-count',
    id: 'one-items-request',
    name: 'One request per load action',
    scope: 'One Load items click through completion and network idle.',
    method: 'GET',
    path: '/api/items',
    expectedCount: 1,
    status: 200,
  },
  browserArguments: ['--no-sandbox'],
  viewport: { width: 1120, height: 800, scale: 1 },
} as const;

const statusCheck = {
  kind: 'text',
  id: 'status',
  name: 'Status',
  scope: 'After the order',
  selector: '#status',
  expectedText: 'Placed',
} as const;

// Decodes a journey as the project loader does and builds its recipe.
function load(journey: unknown) {
  try {
    const saved = Schema.decodeUnknownSync(Schema.fromJsonString(savedJourneySchema), {
      onExcessProperty: 'error',
    })(JSON.stringify(journey));

    return {
      ok: true,
      recipe: Schema.decodeUnknownSync(recipeSchema)(journeyRecipe(saved)),
    } as const;
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    } as const;
  }
}

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
  {
    name: 'both check and checks',
    journey: { ...requestLab, checks: [statusCheck] },
    message: 'Set either check or checks',
  },
  {
    name: 'duplicate check IDs',
    journey: { ...requestLab, check: undefined, checks: [statusCheck, statusCheck] },
    message: 'Check IDs must be unique',
  },
])('rejects $name', ({ journey, message }) => {
  const result = load(journey);

  expect(result.ok).toBe(false);
  expect(result.ok ? '' : result.message).toContain(message);
});

test('keeps a single check working and adds the collectors checks need', () => {
  const single = load(requestLab);
  const several = [
    load({ ...requestLab, name: 'Browse' }),
    load({
      ...requestLab,
      name: 'Order',
      check: undefined,
      checks: [requestLab.check, statusCheck, { ...statusCheck, id: 'total', selector: '#total' }],
    }),
  ];

  expect(single.ok && single.recipe.checks).toEqual([requestLab.check]);
  expect(
    several.map(
      (result) =>
        result.ok && {
          id: result.recipe.id,
          checks: result.recipe.checks.map((check) => check.id),
          collectors: result.recipe.collectors,
        },
    ),
  ).toEqual([
    {
      id: 'Browse',
      checks: [requestLab.check.id],
      collectors: [
        { kind: 'accessibility' },
        { kind: 'timeline' },
        { kind: 'browser-errors' },
        { kind: 'coverage' },
      ],
    },
    {
      id: 'Order',
      checks: [requestLab.check.id, 'status', 'total'],
      collectors: [
        { kind: 'accessibility' },
        { kind: 'timeline' },
        { kind: 'browser-errors' },
        { kind: 'text', selectors: ['#status', '#total'] },
        { kind: 'coverage' },
      ],
    },
  ]);
});

test('lets a journey turn coverage off and runs coverage after the timing samples', () => {
  const result = load({
    ...requestLab,
    collectors: [{ kind: 'coverage', enabled: false }],
  });
  const timed = load({ ...requestLab, collectors: [{ kind: 'performance' }] });

  expect(result.ok && result.recipe.collectors).toEqual([
    { kind: 'accessibility' },
    { kind: 'timeline' },
    { kind: 'browser-errors' },
    { kind: 'coverage', enabled: false },
  ]);
  expect(timed.ok && timed.recipe.collectors.map((item) => item.kind)).toEqual([
    'performance',
    'accessibility',
    'timeline',
    'browser-errors',
    'coverage',
  ]);
});
