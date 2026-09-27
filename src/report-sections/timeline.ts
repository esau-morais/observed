import {
  describeAction,
  describeDuration,
  stepOutcomeLabels,
} from '../interaction-text';
import { escapeText } from '../markdown';
import type { MarkdownSection, SectionSide } from './define';

function describe(side: SectionSide<'timeline'>): string {
  if (side.evidence.status === 'unavailable') {
    return `Steps unavailable: ${escapeText(side.evidence.reason)}`;
  }

  const { steps, finalState } = side.evidence.value;
  const table =
    steps.length === 0
      ? 'No steps are configured.'
      : [
          '| Step | Action | Target | Duration | Outcome |',
          '| --- | --- | --- | --- | --- |',
          ...steps.map(
            (step) =>
              `| ${step.index + 1} | ${describeAction(step.action)} | ${escapeText(step.target ?? '–')} | ${describeDuration(step)} | ${stepOutcomeLabels[step.outcome]} |`,
          ),
        ].join('\n');

  return [
    table,
    finalState.kind === 'recorded'
      ? 'Resulting state: the accessibility tree after the last step is in the viewer and the evidence file.'
      : `Resulting state unavailable: ${escapeText(finalState.reason)}.`,
  ].join('\n\n');
}

export const timeline: MarkdownSection<'timeline'> = ({ base, candidate }) =>
  [
    ...(base === null ? [] : ['### Base · before', describe(base)]),
    `### ${base === null ? 'Current capture' : 'Candidate · after'}`,
    describe(candidate),
  ].join('\n\n');
