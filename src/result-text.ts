import type { Comparison, Side } from './comparison-model';

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
} satisfies Record<Side['check']['outcome'], string>;

export function headline(result: Comparison): string {
  const kind = result.conclusion.kind;
  const subject =
    kind === 'regression' || kind === 'check-failed' || kind === 'no-regression'
      ? result.candidate.check.name
      : result.title;

  return `${conclusionLabels[kind]}: ${subject}`;
}

export function coverage(result: Comparison): string | null {
  return (
    result.candidate.recipe?.check?.scope ??
    result.base.recipe?.check?.scope ??
    null
  );
}
