import { Schema } from 'effect';
import { text } from '../capture/model';
import {
  formatMetric,
  metricAbbreviations,
  performanceMetricSchema,
  sampleDifference,
  sampledPages,
  summarize,
  type PerformanceValue,
  type Summary,
} from '../evidence-kinds/performance';
import { defineCheck, type Evaluation } from './define';

export const performanceCheckSchema = Schema.Struct({
  kind: Schema.Literal('performance'),
  id: text,
  name: text,
  scope: text,
  metric: performanceMetricSchema,
  max: Schema.optionalKey(
    Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
  ),
  maxIncreasePercent: Schema.optionalKey(
    Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0)),
  ),
}).check(
  Schema.makeFilter(
    (check) =>
      check.max !== undefined || check.maxIncreasePercent !== undefined,
    { message: 'A performance check needs max, maxIncreasePercent, or both' },
  ),
);

export type PerformanceCheck = typeof performanceCheckSchema.Type;

type Measured = Extract<Summary, { kind: 'measured' }>;

type Part = {
  outcome: 'passed' | 'failed' | 'unknown';
  detail: string;
};

function describeSummary(check: PerformanceCheck, summary: Measured): string {
  const { metric } = check;

  return `median ${formatMetric(metric, summary.median)} over ${summary.count} samples, range ${formatMetric(metric, summary.min)} to ${formatMetric(metric, summary.max)}`;
}

function expectation(check: PerformanceCheck): string {
  const { metric } = check;
  const name = `Median ${metricAbbreviations[metric]}`;

  return [
    ...(check.max === undefined
      ? []
      : [`${name} at most ${formatMetric(metric, check.max)}.`]),
    ...(check.maxIncreasePercent === undefined
      ? []
      : [
          `${name} no more than ${check.maxIncreasePercent}% above the base median. A larger increase fails only when every candidate sample is higher than every base sample; otherwise it is unknown.`,
        ]),
    'Local samples, not production percentiles.',
  ].join(' ');
}

function absolute(check: PerformanceCheck, summary: Measured): Part | null {
  if (check.max === undefined) {
    return null;
  }

  const within = summary.median <= check.max;

  return {
    outcome: within ? 'passed' : 'failed',
    detail: `Median ${formatMetric(check.metric, summary.median)} is ${within ? 'within' : 'over'} the ${formatMetric(check.metric, check.max)} budget.`,
  };
}

// The relative budget compares candidate samples with base samples, so it is
// decided only for comparable captures whose samples were taken under the
// same recorded conditions on the same page.
function relative(
  check: PerformanceCheck,
  base: PerformanceValue | null,
  candidate: PerformanceValue,
  comparable: boolean,
): Part | null {
  const threshold = check.maxIncreasePercent;
  const { metric } = check;

  if (threshold === undefined) {
    return null;
  }

  if (base === null) {
    return {
      outcome: 'unknown',
      detail: 'No base samples, so the relative budget was not evaluated.',
    };
  }

  if (!comparable) {
    return {
      outcome: 'unknown',
      detail:
        'The captures are not comparable, so the relative budget was not evaluated.',
    };
  }

  const difference = sampleDifference(base, candidate);

  if (difference === 'conditions') {
    return {
      outcome: 'unknown',
      detail:
        'Base and candidate samples were recorded under different conditions, so the relative budget was not evaluated.',
    };
  }

  if (difference === 'page') {
    return {
      outcome: 'unknown',
      detail: `Base samples ended on ${sampledPages(base)} and candidate samples on ${sampledPages(candidate)}, so the relative budget was not evaluated.`,
    };
  }

  const before = summarize(base, metric);
  const after = summarize(candidate, metric);

  if (before.kind === 'unmeasured' || after.kind === 'unmeasured') {
    return {
      outcome: 'unknown',
      detail:
        `Relative budget not evaluated. ${before.kind === 'unmeasured' ? `Base: ${before.reason}` : ''}${after.kind === 'unmeasured' ? ` Candidate: ${after.reason}` : ''}`.trim(),
    };
  }

  if (before.median === 0) {
    return after.median === 0
      ? { outcome: 'passed', detail: 'Base and candidate medians are both 0.' }
      : {
          outcome: 'unknown',
          detail:
            'The base median is 0, so a percentage change is undefined. Use max for this metric.',
        };
  }

  const change = ((after.median - before.median) / before.median) * 100;
  const comparison = `Median ${formatMetric(metric, after.median)} against base ${formatMetric(metric, before.median)} (${change >= 0 ? '+' : ''}${change.toFixed(1)}%; allowed +${threshold}%).`;
  const ranges = `base ${formatMetric(metric, before.min)} to ${formatMetric(metric, before.max)}, candidate ${formatMetric(metric, after.min)} to ${formatMetric(metric, after.max)}`;

  if (change <= threshold) {
    return { outcome: 'passed', detail: comparison };
  }

  if (after.min > before.max) {
    return {
      outcome: 'failed',
      detail: `${comparison} Every candidate sample is higher than every base sample (${ranges}).`,
    };
  }

  return {
    outcome: 'unknown',
    detail: `${comparison} The sample ranges overlap (${ranges}), so these samples do not separate the increase from run-to-run variation. More samples may settle it.`,
  };
}

function combine(parts: readonly Part[]): Part['outcome'] {
  if (parts.some((part) => part.outcome === 'failed')) {
    return 'failed';
  }

  return parts.some((part) => part.outcome === 'unknown')
    ? 'unknown'
    : 'passed';
}

function evaluateSide(
  check: PerformanceCheck,
  value: PerformanceValue,
  relativePart: Part | null,
): Evaluation {
  const summary = summarize(value, check.metric);

  if (summary.kind === 'unmeasured') {
    return { outcome: 'unknown', actual: null, detail: summary.reason };
  }

  const parts = [absolute(check, summary), relativePart].filter(
    (part) => part !== null,
  );

  return {
    outcome: combine(parts),
    actual: describeSummary(check, summary),
    detail: parts.map((part) => part.detail).join(' '),
    reading: formatMetric(check.metric, summary.median),
  };
}

export function evaluatePerformance({
  check,
  base,
  candidate,
  comparable,
}: {
  check: PerformanceCheck;
  base: PerformanceValue | null;
  candidate: PerformanceValue;
  comparable: boolean;
}): { base: Evaluation | null; candidate: Evaluation } {
  const reference: Part | null =
    check.maxIncreasePercent === undefined
      ? null
      : {
          outcome: 'passed',
          detail:
            'Relative budget: 0% change, since these are the base samples it compares with.',
        };

  return {
    base: base === null ? null : evaluateSide(check, base, reference),
    candidate: evaluateSide(
      check,
      candidate,
      relative(check, base, candidate, comparable),
    ),
  };
}

// A candidate that fails the relative budget regressed against the base even
// when the base was already over max. Observed calls this only for comparable
// captures.
export function performanceRegression({
  check,
  base,
  candidate,
}: {
  check: PerformanceCheck;
  base: { value: PerformanceValue; evaluation: Evaluation };
  candidate: { value: PerformanceValue; evaluation: Evaluation };
}): { detail: string } | null {
  const increase = relative(check, base.value, candidate.value, true);

  if (increase?.outcome === 'failed') {
    return { detail: `${check.name} regressed. ${increase.detail}` };
  }

  return base.evaluation.outcome === 'passed' &&
    candidate.evaluation.outcome === 'failed'
    ? {
        detail: `${check.name} passed on base and failed on candidate. ${candidate.evaluation.detail}`,
      }
    : null;
}

export const performance = defineCheck({
  definition: performanceCheckSchema,
  evidence: ['performance'],
  collectors: () => [{ kind: 'performance' }],
  expectation,
  measure: (check) => {
    const limits = [
      ...(check.max === undefined
        ? []
        : [`at most ${formatMetric(check.metric, check.max)}`]),
      ...(check.maxIncreasePercent === undefined
        ? []
        : [`+${check.maxIncreasePercent}% on base`]),
    ];

    return {
      label: `Median ${metricAbbreviations[check.metric]}`,
      limit: limits.join(' and '),
    };
  },
  needsBase: (definition) => definition.maxIncreasePercent !== undefined,
  evaluate: ({ definition, base, candidate, comparable }) =>
    evaluatePerformance({
      check: definition,
      base: base?.evidence.performance ?? null,
      candidate: candidate.evidence.performance,
      comparable,
    }),
  regression: ({ definition, base, candidate }) =>
    performanceRegression({
      check: definition,
      base: {
        value: base.evidence.performance,
        evaluation: base.evaluation,
      },
      candidate: {
        value: candidate.evidence.performance,
        evaluation: candidate.evaluation,
      },
    }),
});
