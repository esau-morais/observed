import { Schema } from 'effect';
import { text, timestamp } from '../capture/model';
import { defineEvidence } from './define';

export const performanceMetrics = [
  'lcp',
  'fcp',
  'ttfb',
  'cls',
  'inp',
  'dom-content-loaded',
  'load',
] as const;

export type PerformanceMetric = (typeof performanceMetrics)[number];

export const performanceMetricSchema = Schema.Literals(performanceMetrics);

export const metricLabels = {
  lcp: 'Largest contentful paint',
  fcp: 'First contentful paint',
  ttfb: 'Time to first byte',
  cls: 'Cumulative layout shift',
  inp: 'Interaction to next paint',
  'dom-content-loaded': 'DOMContentLoaded event end',
  load: 'Load event end',
} satisfies Record<PerformanceMetric, string>;

export const metricAbbreviations = {
  lcp: 'LCP',
  fcp: 'FCP',
  ttfb: 'TTFB',
  cls: 'CLS',
  inp: 'INP',
  'dom-content-loaded': 'DCL',
  load: 'Load',
} satisfies Record<PerformanceMetric, string>;

export const performanceDefaults = { samples: 5, warmup: 1 } as const;

const nonNegative = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0),
);

const sampleSchema = Schema.Struct({
  run: Schema.Int.check(Schema.isGreaterThan(0)),
  warmup: Schema.Boolean,
  startedAt: timestamp,
  finishedAt: timestamp,
  document: text,
  interactions: Schema.NullOr(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  ),
  metrics: Schema.Struct({
    lcp: Schema.NullOr(nonNegative),
    fcp: Schema.NullOr(nonNegative),
    ttfb: Schema.NullOr(nonNegative),
    cls: Schema.NullOr(nonNegative),
    inp: Schema.NullOr(nonNegative),
    'dom-content-loaded': Schema.NullOr(nonNegative),
    load: Schema.NullOr(nonNegative),
  }),
});

export type PerformanceSample = typeof sampleSchema.Type;

const positive = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThan(0),
);

const conditionsSchema = Schema.Struct({
  samples: Schema.Int.check(Schema.isGreaterThan(0)),
  warmup: Schema.Int.check(Schema.isGreaterThan(0)),
  cpu: Schema.Literal('unthrottled'),
  network: Schema.Literal('unthrottled'),
  cache: Schema.Literal('warm'),
  order: Schema.Literal('sequential'),
  viewport: Schema.Struct({
    width: positive,
    height: positive,
    scale: positive,
  }),
});

const recording = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('recorded'), artifact: text }),
  Schema.Struct({ kind: Schema.Literal('unavailable'), reason: text }),
]);

export type Recording = typeof recording.Type;

const inspectionSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('not-requested') }),
  Schema.Struct({
    kind: Schema.Literal('requested'),
    trace: recording,
    profile: recording,
  }),
]);

export type PerformanceInspection = typeof inspectionSchema.Type;

export const performanceValueSchema = Schema.Struct({
  conditions: conditionsSchema,
  samples: Schema.NonEmptyArray(sampleSchema),
  inspection: inspectionSchema,
}).check(
  Schema.makeFilter(
    (value) => {
      const measured = value.samples.filter((sample) => !sample.warmup);
      const warmups = value.samples.length - measured.length;

      return (
        measured.length === value.conditions.samples &&
        warmups === value.conditions.warmup &&
        value.samples.every(
          (sample, index) =>
            sample.run === index + 1 &&
            sample.warmup === index < value.conditions.warmup &&
            sample.startedAt <= sample.finishedAt,
        )
      );
    },
    {
      message:
        'Samples must match the recorded counts, with warm-up runs first and runs numbered in order',
    },
  ),
);

export type PerformanceValue = typeof performanceValueSchema.Type;

export const performance = defineEvidence({
  kind: 'performance',
  title: 'Browser performance',
  schemaVersion: 1,
  collector: {
    samples: Schema.optionalKey(
      Schema.Int.check(Schema.isBetween({ minimum: 3, maximum: 20 })),
    ),
    warmup: Schema.optionalKey(
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 5 })),
    ),
    inspect: Schema.optionalKey(Schema.Boolean),
  },
  value: performanceValueSchema,
});

export function formatMetric(metric: PerformanceMetric, value: number): string {
  if (metric === 'cls') {
    return value.toFixed(3);
  }

  return `${value < 10 ? value.toFixed(1) : Math.round(value).toString()} ms`;
}

export type Summary =
  | {
      kind: 'measured';
      count: number;
      median: number;
      min: number;
      max: number;
    }
  | { kind: 'unmeasured'; count: number; reason: string };

// Warm-up runs are recorded for inspection and never summarized.
export function summarize(
  value: PerformanceValue,
  metric: PerformanceMetric,
): Summary {
  const samples = value.samples.filter((sample) => !sample.warmup);
  const values = samples
    .map((sample) => sample.metrics[metric])
    .filter((item) => item !== null)
    .sort((left, right) => left - right);
  const missing = samples.length - values.length;
  const middle = Math.floor(values.length / 2);
  const upper = values[middle];
  const lower = values.length % 2 === 1 ? upper : values[middle - 1];
  const first = values[0];
  const last = values.at(-1);

  if (
    missing > 0 ||
    upper === undefined ||
    lower === undefined ||
    first === undefined ||
    last === undefined
  ) {
    const unmeasured = samples.filter(
      (sample) => sample.metrics[metric] === null,
    );
    let cause = '';

    if (metric === 'inp') {
      if (unmeasured.some((sample) => sample.interactions === null)) {
        cause = ' because the event timing observer did not register';
      } else if (unmeasured.every((sample) => sample.interactions === 0)) {
        cause = ' because those runs had no recorded interaction';
      }
    }

    return {
      kind: 'unmeasured',
      count: samples.length,
      reason: `${metricAbbreviations[metric]} was not recorded in ${missing} of ${samples.length} samples${cause}.`,
    };
  }

  return {
    kind: 'measured',
    count: values.length,
    median: (lower + upper) / 2,
    min: first,
    max: last,
  };
}

export function describeViewport(value: PerformanceValue): string {
  const { width, height, scale } = value.conditions.viewport;

  return `${width} × ${height} CSS px at ${scale}×`;
}

export function sampledPages(value: PerformanceValue): string {
  return [
    ...new Set(
      value.samples
        .filter((sample) => !sample.warmup)
        .map((sample) => sample.document),
    ),
  ]
    .sort()
    .join(', ');
}

// Samples from the two sides describe the same thing only when they were
// taken under the same recorded conditions and ended on the same page.
export function sampleDifference(
  base: PerformanceValue,
  candidate: PerformanceValue,
): 'conditions' | 'page' | null {
  if (
    JSON.stringify(base.conditions) !== JSON.stringify(candidate.conditions)
  ) {
    return 'conditions';
  }

  return sampledPages(base) === sampledPages(candidate) ? null : 'page';
}
