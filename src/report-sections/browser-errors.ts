import {
  describeErrorCoverage,
  describeErrorTime,
  errorSourceLabels,
} from '../interaction-text';
import { escapeText } from '../markdown';
import type { MarkdownSection, SectionSide } from './define';

function describe(side: SectionSide<'browser-errors'>): string {
  if (side.evidence.status === 'unavailable') {
    return `Error record unavailable: ${escapeText(side.evidence.reason)}`;
  }

  const record = side.evidence.value;

  return [
    escapeText(describeErrorCoverage(record)),
    record.entries.length === 0
      ? 'No page or console errors were read.'
      : record.entries
          .map(
            (error) =>
              `- ${errorSourceLabels[error.source]}, ${escapeText(describeErrorTime(error))}: ${escapeText(error.text.split('\n')[0] ?? '')}`,
          )
          .join('\n'),
  ].join('\n\n');
}

export const browserErrors: MarkdownSection<'browser-errors'> = ({
  base,
  candidate,
}) =>
  [
    'Uncaught page errors and console errors, with the step after which each was read. A listed error is not a check result.',
    ...(base === null ? [] : ['### Base · before', describe(base)]),
    `### ${base === null ? 'Current capture' : 'Candidate · after'}`,
    describe(candidate),
  ].join('\n\n');
