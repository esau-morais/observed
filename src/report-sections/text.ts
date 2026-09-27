import { escapeText } from '../markdown';
import type { MarkdownSection, SectionSide } from './define';

function describe(side: SectionSide<'text'>): string {
  if (side.evidence.status === 'unavailable') {
    return `Unavailable: ${escapeText(side.evidence.reason)}`;
  }

  return side.evidence.value.elements
    .map(
      (element) =>
        `- ${escapeText(element.selector)}: ${element.count} element(s); text: ${element.value === null ? 'not read' : escapeText(JSON.stringify(element.value))}`,
    )
    .join('\n');
}

export const text: MarkdownSection<'text'> = ({ base, candidate }) =>
  [
    ...(base === null ? [] : ['### Base · before', describe(base)]),
    `### ${base === null ? 'Current capture' : 'Candidate · after'}`,
    describe(candidate),
  ].join('\n\n');
