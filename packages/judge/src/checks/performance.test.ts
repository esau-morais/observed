import { Schema } from 'effect';
import { expect, test } from 'vitest';
import {
  performanceValueSchema,
  summarize,
  type PerformanceMetric,
  type PerformanceSample,
  type PerformanceValue,
} from '../evidence/performance';
import {
  evaluatePerformance,
  performanceCheckSchema,
  performanceRegression,
  type PerformanceCheck,
} from './performance';

const decodeValue = Schema.decodeUnknownSync(Schema.fromJsonString(performanceValueSchema));

type Run = [
  startedAt: string,
  finishedAt: string,
  lcp: number,
  ttfb: number,
  domContentLoaded: number,
  load: number,
];

// Real captures of a seeded 400 ms document handler, one warm-up run then
// five samples. FCP equals LCP, CLS is 0 and INP is 16 in every run.
function captured(runs: Run[]): PerformanceValue {
  return decodeValue(
    JSON.stringify({
      conditions: {
        samples: 5,
        warmup: 1,
        cpu: 'unthrottled',
        network: 'unthrottled',
        cache: 'warm',
        order: 'sequential',
        viewport: { width: 1280, height: 800, scale: 1 },
      },
      samples: runs.map(([startedAt, finishedAt, lcp, ttfb, dcl, load], index) => ({
        run: index + 1,
        warmup: index === 0,
        startedAt,
        finishedAt,
        document: '/',
        interactions: 1,
        metrics: {
          lcp,
          fcp: lcp,
          ttfb,
          cls: 0,
          inp: 16,
          'dom-content-loaded': dcl,
          load,
        },
      })),
      inspection: {
        kind: 'requested',
        trace: { kind: 'recorded', artifact: 'performance-trace' },
        profile: { kind: 'recorded', artifact: 'performance-profile' },
      },
    }),
  );
}

const base = captured([
  [
    '2026-09-27T05:08:45.391Z',
    '2026-09-27T05:08:48.199Z',
    64,
    8.200000002980232,
    39,
    39.20000000298023,
  ],
  [
    '2026-09-27T05:08:48.199Z',
    '2026-09-27T05:08:50.884Z',
    28,
    3.7000000029802322,
    18.899999998509884,
    19,
  ],
  [
    '2026-09-27T05:08:50.884Z',
    '2026-09-27T05:08:53.580Z',
    40,
    5.299999997019768,
    25.299999997019768,
    25.5,
  ],
  [
    '2026-09-27T05:08:53.580Z',
    '2026-09-27T05:08:56.262Z',
    28,
    3.600000001490116,
    17,
    17.200000002980232,
  ],
  [
    '2026-09-27T05:08:56.262Z',
    '2026-09-27T05:08:58.929Z',
    32,
    3.899999998509884,
    16.399999998509884,
    16.600000001490116,
  ],
  [
    '2026-09-27T05:08:58.929Z',
    '2026-09-27T05:09:01.611Z',
    32,
    4.100000001490116,
    18.100000001490116,
    18.30000000447035,
  ],
]);

const slow = captured([
  [
    '2026-09-27T05:09:14.123Z',
    '2026-09-27T05:09:17.134Z',
    452,
    404.8999999985099,
    435.70000000298023,
    435.8999999985099,
  ],
  [
    '2026-09-27T05:09:17.135Z',
    '2026-09-27T05:09:20.213Z',
    440,
    404.8999999985099,
    420.3999999985099,
    420.5,
  ],
  [
    '2026-09-27T05:09:20.213Z',
    '2026-09-27T05:09:23.296Z',
    428,
    403.5,
    420.69999999552965,
    420.79999999701977,
  ],
  [
    '2026-09-27T05:09:23.296Z',
    '2026-09-27T05:09:26.378Z',
    428,
    404.3999999985099,
    419.1000000014901,
    419.1000000014901,
  ],
  [
    '2026-09-27T05:09:26.378Z',
    '2026-09-27T05:09:29.445Z',
    432,
    404.3999999985099,
    418.09999999403954,
    418.29999999701977,
  ],
  [
    '2026-09-27T05:09:29.446Z',
    '2026-09-27T05:09:32.527Z',
    428,
    404.5,
    419.6000000014901,
    419.70000000298023,
  ],
]);

const check = (fields: Partial<PerformanceCheck>): PerformanceCheck =>
  Schema.decodeUnknownSync(performanceCheckSchema)({
    kind: 'performance',
    id: 'lcp-budget',
    name: 'Largest contentful paint budget',
    scope: 'Open the page through the journey.',
    metric: 'lcp',
    ...fields,
  });

function samples(
  values: readonly (number | null)[],
  {
    metric = 'lcp',
    warmup = [900],
    interactions = 1,
    document = '/',
    viewport = { width: 1280, height: 800, scale: 1 },
  }: {
    metric?: PerformanceMetric;
    warmup?: number[];
    interactions?: number;
    document?: string;
    viewport?: { width: number; height: number; scale: number };
  } = {},
): PerformanceValue {
  const runs = [...warmup, ...values].map((value, index): PerformanceSample => ({
    run: index + 1,
    warmup: index < warmup.length,
    startedAt: '2026-09-27T00:00:00.000Z',
    finishedAt: '2026-09-27T00:00:01.000Z',
    document,
    interactions,
    metrics: {
      lcp: 30,
      fcp: 30,
      ttfb: 2,
      cls: 0,
      inp: interactions === 0 ? null : 16,
      'dom-content-loaded': 10,
      load: 11,
      [metric]: value,
    },
  }));

  return decodeValue(
    JSON.stringify({
      conditions: {
        samples: values.length,
        warmup: warmup.length,
        cpu: 'unthrottled',
        network: 'unthrottled',
        cache: 'warm',
        order: 'sequential',
        viewport,
      },
      samples: runs,
      inspection: { kind: 'not-requested' },
    }),
  );
}

const evaluate = (
  definition: PerformanceCheck,
  before: PerformanceValue | null,
  after: PerformanceValue,
  comparable = true,
) =>
  evaluatePerformance({
    check: definition,
    base: before,
    candidate: after,
    comparable,
  });

test('a seeded slow document handler regresses against a passing base', () => {
  const definition = check({ max: 200, maxIncreasePercent: 20 });
  const result = evaluate(definition, base, slow);

  expect(result.base?.outcome).toBe('passed');
  expect(result.candidate.outcome).toBe('failed');
  expect(result.candidate.detail).toContain(
    'Every candidate sample is higher than every base sample (base 28 ms to 40 ms, candidate 428 ms to 440 ms)',
  );
});

test('a relative slowdown is a regression even when the base was already over max', () => {
  const definition = check({ max: 20, maxIncreasePercent: 20 });
  const result = evaluate(definition, base, slow);

  if (result.base === null) {
    throw new Error('The base was not evaluated');
  }

  expect(result.base.outcome).toBe('failed');
  expect(
    performanceRegression({
      check: definition,
      base: { value: base, evaluation: result.base },
      candidate: { value: slow, evaluation: result.candidate },
    })?.detail,
  ).toContain('Every candidate sample is higher than every base sample');
});

test('the same recorded samples pass a layout shift budget they meet', () => {
  const result = evaluate(check({ metric: 'cls', max: 0.1 }), base, slow);

  expect([result.base?.outcome, result.candidate.outcome]).toEqual(['passed', 'passed']);
});

test('a relative budget is unknown for captures that are not comparable', () => {
  const result = evaluate(check({ maxIncreasePercent: 20 }), base, slow, false);

  expect(result.candidate.outcome).toBe('unknown');
  expect(result.candidate.detail).toContain('not comparable');
});

test('a relative budget is unknown when the sides sampled under different conditions or pages', () => {
  const definition = check({ maxIncreasePercent: 10 });
  const before = samples([100, 100, 100]);

  expect(
    evaluate(
      definition,
      before,
      samples([100, 100, 100], {
        viewport: { width: 390, height: 844, scale: 3 },
      }),
    ).candidate.outcome,
  ).toBe('unknown');
  expect(
    evaluate(definition, before, samples([100, 100, 100], { document: '/sign-in' })).candidate
      .detail,
  ).toContain('Base samples ended on / and candidate samples on /sign-in');
});

test('an increase inside the measured spread is unknown, not a failure or a pass', () => {
  const result = evaluate(
    check({ maxIncreasePercent: 10 }),
    samples([100, 104, 110, 150, 108]),
    samples([120, 125, 118, 140, 121]),
  );

  expect(result.candidate.outcome).toBe('unknown');
  expect(result.candidate.detail).toContain('sample ranges overlap');
});

test('warm-up runs are recorded but excluded from the median and range', () => {
  expect(summarize(samples([10, 30, 20, 40], { warmup: [5000] }), 'lcp')).toEqual({
    kind: 'measured',
    count: 4,
    median: 25,
    min: 10,
    max: 40,
  });
});

test('a metric missing from any sample makes the check unknown on that side', () => {
  expect(
    evaluate(check({ max: 1000 }), samples([100, 100, 100]), samples([100, null, 100])).candidate,
  ).toEqual({
    outcome: 'unknown',
    actual: null,
    detail: 'LCP was not recorded in 1 of 3 samples.',
  });
});

test('INP without a recorded interaction is unknown and says why', () => {
  const result = evaluate(
    check({ metric: 'inp', max: 200 }),
    null,
    samples([100, 100, 100], { interactions: 0 }),
  );

  expect(result.candidate.outcome).toBe('unknown');
  expect(result.candidate.detail).toContain('had no recorded interaction');
});

test('without base samples a relative budget is unknown even when the absolute budget passes', () => {
  const result = evaluate(
    check({ max: 1000, maxIncreasePercent: 20 }),
    null,
    samples([100, 100, 100]),
  );

  expect(result.base).toBeNull();
  expect(result.candidate.outcome).toBe('unknown');
});

test('a zero base median cannot support a percentage budget', () => {
  const result = evaluate(
    check({ metric: 'cls', maxIncreasePercent: 20 }),
    samples([0, 0, 0], { metric: 'cls' }),
    samples([0.2, 0.2, 0.2], { metric: 'cls' }),
  );

  expect(result.candidate.outcome).toBe('unknown');
  expect(result.candidate.detail).toContain('percentage change is undefined');
});

test('recorded samples that disagree with their stated counts are rejected', () => {
  expect(() =>
    decodeValue(
      JSON.stringify({
        ...base,
        conditions: {
          ...base.conditions,
          samples: base.conditions.samples + 1,
        },
      }),
    ),
  ).toThrow('Samples must match the recorded counts');
});
