import type {
  Anchor,
  Check,
  CheckVerdict,
  Comparison,
  Journey,
  Measure,
  Side,
} from './comparison-model';

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

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function resultCounts(result: Comparison): string {
  const verdicts = result.journeys.flatMap((journey) =>
    journey.checks.map((check) => check.verdict),
  );
  const count = (...kinds: CheckVerdict['verdict'][]) =>
    verdicts.filter((verdict) => kinds.includes(verdict)).length;

  return [
    `${plural(count('regression', 'failed'), 'issue', 'issues')} found`,
    `${plural(count('passed'), 'behavior', 'behaviors')} verified`,
    `${count('unknown', 'not-run')} unresolved`,
  ].join(' · ');
}

export function describeMeasure(
  measure: Measure,
  mode: Comparison['mode'],
): string {
  const value = (reading: string | null) => reading ?? 'unknown';
  const values =
    mode === 'preview'
      ? value(measure.candidate)
      : `${value(measure.base)} → ${value(measure.candidate)}`;

  return `${measure.label} ${values}${measure.limit === null ? '' : `, ${measure.limit}`}`;
}

// A failing check is explained by its values; an unknown one by its detail,
// which says why it is unknown.
export function shownMeasure(check: CheckVerdict): Measure | null {
  return check.measure !== undefined &&
    (check.verdict === 'regression' || check.verdict === 'failed')
    ? check.measure
    : null;
}

export const leadingVerdicts = {
  regression: 'regression',
  'check-failed': 'failed',
  unavailable: 'unknown',
  'no-regression': null,
  'not-checked': null,
  preview: null,
} satisfies Record<Kind, CheckVerdict['verdict'] | null>;

// The verdict and the one reading that explains it, short enough for a check
// run title or a notification.
const anchorWords = {
  'stack-frame': 'thrown at',
  'component-source': 'component at',
  'test-location': 'test at',
  'diff-name-match': 'name matches changed line',
} satisfies Record<Anchor['basis'], string>;

// A location is a fact about where the evidence points, never a cause.
export function anchorLocation(
  journey: Journey,
  check: CheckVerdict,
): { words: string; place: string } | null {
  for (const finding of journey.findings) {
    if (
      finding.checks.includes(check.id) &&
      finding.location.kind === 'anchored'
    ) {
      const [anchor] = finding.location.anchors;

      return {
        words:
          anchor.basis === 'stack-frame' && finding.subject === 'Console error'
            ? 'logged at'
            : anchorWords[anchor.basis],
        place: `${anchor.path}:${anchor.line}`,
      };
    }
  }

  return null;
}

export function headlineParts(result: Comparison): {
  label: string;
  subject: string;
} {
  const kind = result.conclusion.kind;
  const [first, ...rest] = leadingChecks(result);
  let subject = result.title;

  if (first !== undefined) {
    const measure = shownMeasure(first.check);

    subject = `${measure === null ? first.check.name : describeMeasure(measure, result.mode)}${rest.length === 0 ? '' : `, plus ${plural(rest.length, 'more check', 'more checks')}`}`;
  }

  return { label: conclusionLabels[kind], subject };
}

// The checks whose verdict decided the result, in journey order.
export function leadingChecks(
  result: Comparison,
): { journey: Journey; check: CheckVerdict }[] {
  const verdict = leadingVerdicts[result.conclusion.kind];

  return result.journeys.flatMap((journey) =>
    journey.checks
      .filter((check) => check.verdict === verdict)
      .map((check) => ({ journey, check })),
  );
}

export function headline(result: Comparison): string {
  const { label, subject } = headlineParts(result);

  return `${label}: ${subject}`;
}
