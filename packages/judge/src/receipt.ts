import type { CheckVerdict, Comparison, Conclusion, Journey, Measure } from './result';
import { addedText, journeyAlteredDetail } from './words';

export const receiptStates = ['failed', 'unknown', 'changed', 'checked'] as const;

export type ReceiptState = (typeof receiptStates)[number];

type Line = { state: ReceiptState; subject: string; evidence: string };

const conclusionLabels = {
  regression: 'Regression',
  'check-failed': 'Check failed',
  unavailable: 'Unknown',
  'no-regression': 'No regression',
  'not-checked': 'Nothing checked',
  preview: 'Preview',
} satisfies Record<Conclusion['kind'], string>;

const previewText = 'A preview has no base revision to judge against.';
const unreadBaseText =
  "The base revision's observed.json was not read, so the check has no baseline.";
const testFileText = 'This change alters its test file, so the check has no baseline.';

function oneLine(value: string): string {
  return value.replace(/[\p{Cc}\p{Zl}\p{Zp}\s]+/gu, ' ').trim();
}

function measured(measure: Measure | undefined): string | null {
  if (measure === undefined || (measure.base === null && measure.candidate === null)) {
    return null;
  }

  return [
    measure.base === null ? null : `base ${measure.base}`,
    measure.candidate === null ? null : `candidate ${measure.candidate}`,
    measure.limit,
  ]
    .filter((part) => part !== null)
    .join(' · ');
}

function noBaseline(check: CheckVerdict, result: Comparison): string | null {
  if (result.mode === 'preview') {
    return previewText;
  }

  if (result.recipe.kind === 'unavailable') {
    return unreadBaseText;
  }

  switch (check.recipe?.change) {
    case undefined:
    case 'removed':
    case 'altered':
      return null;
    case 'journey-altered':
      return journeyAlteredDetail(check.recipe.fields);
    case 'added':
      return addedText;
    case 'test-file-changed':
      return testFileText;
    default:
      return check.recipe satisfies never;
  }
}

function checkLine(check: CheckVerdict, result: Comparison): Line {
  const line = (state: ReceiptState, evidence: string): Line => ({
    state,
    subject: check.name,
    evidence,
  });

  switch (check.verdict) {
    case 'regression':
    case 'failed':
      return line('failed', measured(check.measure) ?? check.detail);
    case 'unknown':
    case 'not-run':
      return line('unknown', check.detail);
    case 'passed': {
      const missing = noBaseline(check, result);

      return missing === null
        ? line('checked', measured(check.measure) ?? check.expectation)
        : line('unknown', missing);
    }
    default:
      return check.verdict satisfies never;
  }
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function comparisonLines(comparison: Journey['comparison']): Line[] {
  switch (comparison.kind) {
    case 'preview':
      return [];
    case 'unavailable':
      return [{ state: 'unknown', subject: 'Comparison', evidence: comparison.reasons.join('; ') }];
    case 'available': {
      const { requestDifference, visual } = comparison;
      const requests: Line[] =
        requestDifference === 0
          ? []
          : [
              {
                state: 'changed',
                subject: 'Requests',
                evidence: `${plural(Math.abs(requestDifference), 'request')} ${requestDifference > 0 ? 'more' : 'fewer'} on the candidate`,
              },
            ];

      switch (visual.kind) {
        case 'identical':
        case 'below-threshold':
          return requests;
        case 'changed':
          return [
            {
              state: 'changed',
              subject: 'Screenshot',
              evidence: `${plural(visual.changedPixels, 'pixel')} in ${plural(visual.regionCount, 'region')}`,
            },
            ...requests,
          ];
        case 'size-differs':
          return [
            {
              state: 'changed',
              subject: 'Screenshot size',
              evidence: `base ${visual.base.width}x${visual.base.height} · candidate ${visual.candidate.width}x${visual.candidate.height}`,
            },
            ...requests,
          ];
        case 'unavailable':
          return [
            { state: 'unknown', subject: 'Screenshot', evidence: visual.reason },
            ...requests,
          ];
        default:
          return visual satisfies never;
      }
    }
    default:
      return comparison satisfies never;
  }
}

function ordered(lines: readonly Line[]): Line[] {
  return receiptStates.flatMap((state) => lines.filter((line) => line.state === state));
}

export function receipt(result: Comparison): string {
  const groups = [
    ...result.journeys.map((journey) => ({
      title: journey.title,
      lines: ordered([
        ...journey.checks.map((check) => checkLine(check, result)),
        ...comparisonLines(journey.comparison),
      ]),
    })),
    ...result.removedJourneys
      .filter((journey) => journey.checks.length > 0)
      .map((journey) => ({
        title: journey.journey,
        lines: ordered(journey.checks.map((check) => checkLine(check, result))),
      })),
  ];
  const lines = groups.flatMap((group) => group.lines);
  const count = (state: ReceiptState) => lines.filter((line) => line.state === state).length;
  const width = Math.max(...receiptStates.map((state) => state.length));
  // A pass printed as unknown has no baseline, so it cannot make the run a no-regression.
  const conclusion =
    result.conclusion.kind === 'no-regression' && count('checked') === 0
      ? 'not-checked'
      : result.conclusion.kind;
  const row = ({ state, subject, evidence }: Line) =>
    `  ${state.padEnd(width)}  ${[subject, evidence].map(oneLine).join(' · ')}`;

  return [
    oneLine(result.title),
    ...groups.flatMap((group) => [
      ...(groups.length > 1 ? [oneLine(group.title)] : []),
      ...(group.lines.length === 0 ? ['  Nothing to report.'] : group.lines.map(row)),
    ]),
    `${conclusionLabels[conclusion]} · ${[...receiptStates]
      .reverse()
      .map((state) => `${count(state)} ${state}`)
      .join(', ')}`,
  ].join('\n');
}
