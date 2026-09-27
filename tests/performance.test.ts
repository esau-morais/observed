import { Schema } from 'effect';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { readingSchema, toSample } from '../src/capture/collectors/performance';
import { describeConditions, performanceRows } from '../src/performance-text';
import {
  evaluatePerformance,
  performanceCheckSchema,
  performanceRegression,
  type PerformanceCheck,
} from '../src/checks/performance';
import {
  performanceValueSchema,
  summarize,
  type PerformanceMetric,
  type PerformanceSample,
  type PerformanceValue,
} from '../src/evidence-kinds/performance';

const decodeValue = Schema.decodeUnknownSync(
  Schema.fromJsonString(performanceValueSchema),
);

const fixture = (name: string) =>
  readFileSync(
    new URL(`fixtures/performance/${name}`, import.meta.url),
    'utf8',
  );

// Real captures of a seeded 400 ms document handler; provenance in
// fixtures/performance/README.md.
const base = decodeValue(fixture('base.json'));
const slow = decodeValue(fixture('slow-document.json'));

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
  const runs = [...warmup, ...values].map(
    (value, index): PerformanceSample => ({
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
    }),
  );

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

const reading = (name: string, run: number) =>
  Schema.decodeUnknownSync(readingSchema)(
    fixture(`raw/${name}/run-${String(run).padStart(2, '0')}.json`),
  ).data.result;

test('the samples match agent-browser output for every recorded run', () => {
  for (const [name, value] of [
    ['base', base],
    ['slow-document', slow],
  ] as const) {
    for (const sample of value.samples) {
      expect(
        toSample(reading(name, sample.run), {
          ...sample,
          viewport: value.conditions.viewport,
          previousOrigin:
            sample.run === 1 ? null : reading(name, sample.run - 1).timeOrigin,
        }),
      ).toEqual({ kind: 'sample', sample });
    }
  }
});

test('a run that repeats the previous document or viewport is not a sample', () => {
  const second = reading('base', 2);
  const run = {
    run: 2,
    warmup: false,
    startedAt: '2026-09-27T00:00:00.000Z',
    finishedAt: '2026-09-27T00:00:01.000Z',
    viewport: base.conditions.viewport,
    previousOrigin: null,
  };

  expect(
    toSample(second, { ...run, previousOrigin: second.timeOrigin }),
  ).toEqual({
    kind: 'rejected',
    reason:
      'Run 2 did not load a new page, so its timings repeat the previous run',
  });
  expect(
    toSample(second, {
      ...run,
      viewport: { width: 390, height: 844, scale: 3 },
    }),
  ).toEqual({
    kind: 'rejected',
    reason: 'Browser viewport in run 2 does not match the saved recipe',
  });
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

  expect([result.base?.outcome, result.candidate.outcome]).toEqual([
    'passed',
    'passed',
  ]);
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
    evaluate(
      definition,
      before,
      samples([100, 100, 100], { document: '/sign-in' }),
    ).candidate.detail,
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
  expect(
    summarize(samples([10, 30, 20, 40], { warmup: [5000] }), 'lcp'),
  ).toEqual({ kind: 'measured', count: 4, median: 25, min: 10, max: 40 });
});

test('a metric missing from any sample makes the check unknown on that side', () => {
  expect(
    evaluate(
      check({ max: 1000 }),
      samples([100, 100, 100]),
      samples([100, null, 100]),
    ).candidate,
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

const view = (value: PerformanceValue) =>
  ({ kind: 'performance', status: 'recorded', value }) as const;

test('the table does not compare samples taken under different conditions or pages', () => {
  const before = samples([100, 100, 100]);
  const change = (after: PerformanceValue) =>
    performanceRows(view(before), view(after))[0]?.change;

  expect(change(samples([150, 150, 150]))).toBe('+50 ms (+50.0%)');
  expect(
    change(
      samples([150, 150, 150], {
        viewport: { width: 390, height: 844, scale: 3 },
      }),
    ),
  ).toBe('Not compared: conditions differ');
  expect(change(samples([150, 150, 150], { document: '/sign-in' }))).toBe(
    'Not compared: different pages',
  );
});

test('the conditions text states the run order the timestamps show', () => {
  expect(describeConditions(view(base), view(slow))).toContain(
    'Base samples ran before candidate samples, not interleaved',
  );
  expect(describeConditions(view(slow), view(base))).toContain(
    'Candidate samples ran before base samples, not interleaved',
  );
});
