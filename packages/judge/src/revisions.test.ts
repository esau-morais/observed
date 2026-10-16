import { Schema } from 'effect';
import { expect, test } from 'vitest';
import { savedJourneySchema, type SavedJourney } from './journey';
import { recipePlan } from './revisions';

const parseJourney = (text: string): SavedJourney =>
  Schema.decodeUnknownSync(Schema.fromJsonString(savedJourneySchema))(text);

const loadItems = {
  name: 'Load items',
  path: '/',
  ready: [{ kind: 'wait-text', text: 'Load items' }],
  steps: [{ kind: 'click-role', role: 'button', name: 'Load items' }, { kind: 'network-idle' }],
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

const journey = (value: unknown): SavedJourney => parseJourney(JSON.stringify(value));

const provenance = {
  kind: 'read',
  commit: 'c'.repeat(40),
  sha256: 'd'.repeat(64),
} as const;

const read = (...journeys: [SavedJourney, ...SavedJourney[]]) =>
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
    mask: [],
    maxAgeMs: 86_400_000,
  });

  for (const candidate of [reordered, explicit]) {
    expect(recipePlan({ base: read(base), candidate: [candidate] }, 'unused').scope).toEqual({
      kind: 'unchanged',
      base: provenance,
    });
  }
});

test('a new screenshot mask alters the journey, so it cannot hide a visual change', () => {
  const plan = recipePlan(
    {
      base: read(journey(loadItems)),
      candidate: [journey({ ...loadItems, mask: ['#result'] })],
    },
    'unused',
  );

  expect(plan.judge('Load items')).toEqual({
    kind: 'compared',
    base: [loadItems.check],
    fields: ['mask'],
  });
});

test('an altered expectation keeps both values and the base definition', () => {
  const base = journey(loadItems);
  const candidate = journey({
    ...loadItems,
    check: { ...loadItems.check, expectedCount: 2 },
  });
  const plan = recipePlan({ base: read(base), candidate: [candidate] }, 'unused');

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
  const plan = recipePlan({ base: read(...base), candidate: [...candidate] }, 'unused');

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
