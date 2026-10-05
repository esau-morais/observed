import reportFixture from './fixtures/report/errors-result.json';
import { comparisonSchema, type ChangeMap } from '../src/comparison-model';
import { proposeSaving } from '../src/generated-proposals';
import { Effect, Schema } from 'effect';
import { expect, test } from 'vitest';
import { parseGeneratedJourneys } from '../src/generated-journeys';
import { recipeSchema } from '../src/capture/recipe';
import {
  generatedBaselineChecks,
  baselineBrowserErrors,
  baselineServerErrors,
} from '../src/checks/baseline';
import type { Observations } from '../src/capture/model';
import type { EvidenceValue } from '../src/evidence-kinds';

const proposal = {
  schemaVersion: 1,
  journeys: [
    {
      name: 'Open details',
      path: '/',
      ready: [],
      steps: [],
      targets: ['public/details.js'],
      reason: 'The saved journey does not open details.',
    },
  ],
};
const parse = (value: unknown) =>
  Effect.runPromise(parseGeneratedJourneys(JSON.stringify(value), []));

test.each([
  { checks: [] },
  { check: { kind: 'text', expected: 'wrong' } },
  { start: ['echo', 'injected'] },
  { browserArguments: ['--disable-web-security'] },
  { collectors: [] },
  { targets: ['../outside.js'] },
])(
  'rejects generated expectations, commands, and escaped target paths: %j',
  async (fields) => {
    await expect(
      parse({
        ...proposal,
        journeys: [{ ...proposal.journeys[0], ...fields }],
      }),
    ).rejects.toThrow();
  },
);

test('enforces the journey budget and protects saved names', async () => {
  await expect(
    parse({
      ...proposal,
      journeys: Array.from({ length: 4 }, (_, index) => ({
        ...proposal.journeys[0],
        name: `Journey ${index}`,
      })),
    }),
  ).rejects.toThrow();
  await expect(
    Effect.runPromise(
      parseGeneratedJourneys(JSON.stringify(proposal), [
        { name: 'Open details', path: '/', ready: [], steps: [] },
      ]),
    ),
  ).rejects.toThrow('cannot replace');
});

test('keeps the fixed checks in the recorded recipe and rejects a relaxed generated recipe', async () => {
  const {
    recipes: [recipe],
  } = await parse(proposal);
  expect(recipe?.checks).toEqual(generatedBaselineChecks);
  expect(recipe?.generated?.targets).toEqual(['public/details.js']);
  expect(() =>
    Schema.decodeUnknownSync(recipeSchema)({ ...recipe, checks: [] }),
  ).toThrow('fixed baseline');
});

const observations: Observations = {
  schemaVersion: 3,
  requests: [],
  browserErrors: [],
  window: {
    startedAt: '2026-10-05T00:00:00.000Z',
    finishedAt: '2026-10-05T00:00:01.000Z',
  },
};
const browserSide = (messages: string[], complete = true) => ({
  observations,
  evidence: {
    'browser-errors': {
      steps: 0,
      coverage: complete
        ? { kind: 'complete' }
        : { kind: 'incomplete', reason: 'Read failed' },
      entries: messages.map((text) => ({
        source: 'page',
        text,
        step: null,
        after: null,
        seenAt: observations.window.finishedAt,
      })),
    } satisfies EvidenceValue<'browser-errors'>,
  },
});
const browserDefinition = generatedBaselineChecks[0];

test('checks errors before the first step and ignores only errors already on the baseline', () => {
  const result = baselineBrowserErrors.evaluate({
    definition: browserDefinition,
    base: browserSide(['Existing error']),
    candidate: browserSide(['Existing error', 'New error']),
    comparable: true,
  });
  expect(result.candidate).toMatchObject({ outcome: 'failed', actual: 1 });
  const unchanged = baselineBrowserErrors.evaluate({
    definition: browserDefinition,
    base: browserSide(['Existing error']),
    candidate: browserSide(['Existing error']),
    comparable: true,
  });
  expect(unchanged.candidate.outcome).toBe('passed');
});

test('does not pass a baseline check from absent or incomplete evidence', () => {
  expect(
    baselineBrowserErrors.evaluate({
      definition: browserDefinition,
      base: null,
      candidate: browserSide([]),
      comparable: false,
    }).candidate.outcome,
  ).toBe('not-run');
  expect(
    baselineBrowserErrors.evaluate({
      definition: browserDefinition,
      base: browserSide([]),
      candidate: browserSide([], false),
      comparable: true,
    }).candidate.outcome,
  ).toBe('unknown');
});

test('server baseline counts new failures by route and occurrence, without failing changed successful data', () => {
  const side = (routes: [string, number][]) => ({
    evidence: {},
    observations: {
      ...observations,
      requests: routes.map(([path, status]) => ({
        method: 'GET',
        origin: 'application' as const,
        path,
        status,
        startedAt: observations.window.startedAt,
      })),
    },
  });
  const evaluate = (before: [string, number][], after: [string, number][]) =>
    baselineServerErrors.evaluate({
      definition: generatedBaselineChecks[2],
      base: side(before),
      candidate: side(after),
      comparable: true,
    }).candidate;
  expect(
    evaluate(
      [['/existing', 500]],
      [
        ['/existing', 500],
        ['/new', 500],
      ],
    ),
  ).toMatchObject({ outcome: 'failed', actual: 1 });
  expect(
    evaluate(
      [['/existing', 500]],
      [
        ['/existing', 500],
        ['/existing', 500],
      ],
    ),
  ).toMatchObject({ outcome: 'failed', actual: 1 });
  expect(evaluate([['/data', 200]], [['/data', 200]])).toMatchObject({
    outcome: 'passed',
    actual: 0,
  });
});

test('proposes saving only from executed changed-line evidence, and never drops a saved journey', () => {
  const result = Schema.decodeUnknownSync(comparisonSchema)(reportFixture);
  const journey = {
    ...result.journeys[0],
    generated: { targets: ['app.js'] as const, reason: 'Unobserved change' },
  };
  const withoutCoverage: ChangeMap = {
    kind: 'unavailable',
    reason: 'No coverage',
  };
  expect(
    proposeSaving(journey, 0, withoutCoverage, 3).savingProposal,
  ).toBeUndefined();
  const withCoverage: ChangeMap = {
    kind: 'recorded',
    blocks: [
      {
        id: 'file:app.js',
        kind: 'file',
        path: 'app.js',
        changed: true,
        changedLines: [[2, 2]],
        imports: { kind: 'scanned', unresolved: [] },
      },
      { id: 'journey:1', kind: 'journey', title: journey.title },
    ],
    connections: [
      {
        kind: 'ran-in',
        from: 'file:app.js',
        to: 'journey:1',
        ran: 1,
        notRan: 0,
        evidence: [{ kind: 'artifact', path: 'coverage.json' }],
      },
    ],
  };
  expect(proposeSaving(journey, 0, withCoverage, 3).savingProposal).toEqual({
    action: 'replace',
    files: ['app.js'],
  });
  expect(
    proposeSaving(journey, 1, withCoverage, 2).savingProposal,
  ).toBeUndefined();
  expect(
    proposeSaving(journey, 0, withCoverage, 2).savingProposal?.action,
  ).toBe('save');
  expect(journey).not.toHaveProperty('savingProposal');
});
