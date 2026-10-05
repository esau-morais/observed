import { Schema } from 'effect';
import { text } from '../capture/model';
import { signature } from './browser-errors';
import { defineCheck, type Evaluation } from './define';

const identity = { id: text, name: text, scope: text };

function added(before: readonly string[], after: readonly string[]): string[] {
  const remaining = new Map<string, number>();
  for (const key of before) {
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }

  return after.filter((key) => {
    const count = remaining.get(key) ?? 0;
    if (count === 0) {
      return true;
    }

    remaining.set(key, count - 1);

    return false;
  });
}

function compareErrors(
  before: readonly string[] | null,
  after: readonly string[],
) {
  const base: Evaluation | null =
    before === null
      ? null
      : {
          outcome: 'passed',
          actual: 0,
          detail: `Base defines the baseline, with ${before.length} recorded error(s).`,
        };
  if (before === null) {
    return {
      base,
      candidate: {
        outcome: 'not-run',
        actual: null,
        detail:
          'Finding new errors needs complete evidence from both captures.',
      } satisfies Evaluation,
    };
  }

  const errors = added(before, after);

  return {
    base,
    candidate: {
      outcome: errors.length === 0 ? 'passed' : 'failed',
      actual: errors.length,
      detail:
        errors.length === 0
          ? 'No new errors compared with base.'
          : `${errors.length} new error(s): ${errors.slice(0, 3).join('; ')}.`,
    } satisfies Evaluation,
  };
}

export const baselineBrowserErrors = defineCheck({
  definition: Schema.Struct({
    kind: Schema.Literal('baseline-browser-errors'),
    ...identity,
  }),
  evidence: ['browser-errors'],
  needsBase: true,
  collectors: () => [{ kind: 'browser-errors' }],
  expectation: () =>
    'No new page or console errors, including navigation and readiness, compared with base.',
  measure: () => ({ label: 'New browser errors', limit: 'none allowed' }),
  evaluate: ({ base, candidate }) => {
    const before = base?.evidence['browser-errors'] ?? null;
    const after = candidate.evidence['browser-errors'];
    if (
      before?.coverage.kind === 'incomplete' ||
      after.coverage.kind === 'incomplete'
    ) {
      const unknown: Evaluation = {
        outcome: 'unknown',
        actual: null,
        detail:
          'The browser error record is incomplete; new errors cannot be checked.',
      };

      return { base: before === null ? null : unknown, candidate: unknown };
    }

    return compareErrors(
      before?.entries.map(signature) ?? null,
      after.entries.map(signature),
    );
  },
});

export const baselineServerErrors = defineCheck({
  definition: Schema.Struct({
    kind: Schema.Literal('baseline-server-errors'),
    ...identity,
  }),
  evidence: [],
  needsBase: true,
  collectors: () => [],
  expectation: () =>
    'No additional responses of 500 or above for the same method, origin, and pathname compared with base.',
  measure: () => ({ label: 'New server errors', limit: 'none allowed' }),
  evaluate: ({ base, candidate }) => {
    const errors = (side: typeof candidate) =>
      side.observations.requests
        .filter((request) => request.status >= 500)
        .map((request) => `${request.method} ${request.origin}${request.path}`);

    return compareErrors(
      base === null ? null : errors(base),
      errors(candidate),
    );
  },
});

export const generatedBaselineChecks = [
  {
    kind: 'baseline-browser-errors',
    id: 'generated-browser-errors',
    name: 'No new browser errors',
    scope: 'The generated journey, including navigation and readiness',
  },
  {
    kind: 'accessibility',
    id: 'generated-accessibility',
    name: 'No new serious accessibility violations',
    scope: 'The final page of the generated journey',
    impact: 'serious',
  },
  {
    kind: 'baseline-server-errors',
    id: 'generated-server-errors',
    name: 'No new server errors',
    scope: 'Responses recorded in the generated journey',
  },
] as const;
