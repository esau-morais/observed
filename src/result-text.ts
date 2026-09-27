import type { Check, CheckVerdict, Comparison, Side } from './comparison-model';

type Kind = Comparison['conclusion']['kind'];

export type Tone = 'regression' | 'unknown' | 'checked' | 'neutral';

export const conclusionLabels = {
  regression: 'Regression',
  'check-failed': 'Check failed',
  unavailable: 'Unavailable',
  'no-regression': 'No regression',
  'not-checked': 'Not checked',
  preview: 'Preview',
} satisfies Record<Kind, string>;

export const conclusionTones = {
  regression: 'regression',
  'check-failed': 'regression',
  unavailable: 'unknown',
  'no-regression': 'checked',
  'not-checked': 'neutral',
  preview: 'neutral',
} satisfies Record<Kind, Tone>;

export const toneSymbols = {
  regression: '!',
  unknown: '?',
  checked: '✓',
  neutral: '–',
} satisfies Record<Tone, string>;

export const checkTones = {
  passed: 'checked',
  failed: 'regression',
  'not-run': 'neutral',
  unknown: 'unknown',
} satisfies Record<Check['outcome'], Tone>;

export const executionLabels = {
  complete: 'Complete',
  'capture-failed': 'Capture failed',
  unavailable: 'Unavailable',
} satisfies Record<Side['execution'], string>;

export const checkLabels = {
  passed: 'Passed',
  failed: 'Failed',
  'not-run': 'Not run',
  unknown: 'Unknown',
} satisfies Record<Check['outcome'], string>;

export const verdictLabels = {
  regression: 'Regression',
  failed: 'Failed',
  unknown: 'Unknown',
  passed: 'Passed',
  'not-run': 'Not run',
} satisfies Record<CheckVerdict['verdict'], string>;

export const verdictTones = {
  regression: 'regression',
  failed: 'regression',
  unknown: 'unknown',
  passed: 'checked',
  'not-run': 'neutral',
} satisfies Record<CheckVerdict['verdict'], Tone>;

export function checkSummary(result: Comparison): string {
  const { passed, total } = result.summary;

  return total === 0
    ? 'No named checks configured'
    : `${passed} of ${total} ${total === 1 ? 'check' : 'checks'} passed`;
}

export function headline(result: Comparison): string {
  const kind = result.conclusion.kind;
  const [first, ...rest] = result.journeys.flatMap((journey) =>
    journey.checks.filter(
      (item) =>
        (kind === 'regression' && item.verdict === 'regression') ||
        (kind === 'check-failed' && item.verdict === 'failed'),
    ),
  );
  let subject = result.title;

  if (first !== undefined) {
    subject =
      rest.length === 0 ? first.name : `${first.name} and ${rest.length} more`;
  } else if (kind === 'no-regression') {
    const [only, ...others] = result.journeys.flatMap(
      (journey) => journey.checks,
    );

    subject =
      only !== undefined && others.length === 0
        ? only.name
        : checkSummary(result);
  }

  return `${conclusionLabels[kind]}: ${subject}`;
}
