import { renderChanges, type ReactEvidence } from '../evidence-kinds/react';
import { escapeText } from '../markdown';
import type { MarkdownSection, SectionSide } from './define';

function table(
  columns: readonly string[],
  rows: readonly (readonly (string | number)[])[],
): string {
  return [
    `| ${columns.join(' | ')} |`,
    `| ${columns.map((_, index) => (index === 0 ? '---' : '---:')).join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function describe(side: SectionSide<'react'>): string {
  if (side.evidence.status === 'unavailable') {
    return `Unavailable: ${escapeText(side.evidence.reason)}`;
  }

  const value = side.evidence.value;
  const renderers = value.renderers
    .map(
      (renderer) =>
        `React ${escapeText(renderer.version ?? 'version unknown')}, ${renderer.build} build`,
    )
    .join('; ');
  const limits = [
    value.truncated.components && 'rendered components',
    value.truncated.mounted && 'mounted component names',
    value.truncated.subtree && 'the rendered subtree',
  ].filter((item) => item !== false);

  return [
    `${value.commits} commit(s) during steps. ${renderers}.`,
    ...(limits.length === 0
      ? []
      : [
          `Recording limit reached for ${limits.join(', ')}; components beyond it are not listed.`,
        ]),
    value.components.length === 0
      ? 'No component rendered during steps.'
      : table(
          ['Component', 'Renders', 'Mounts', 'Updates'],
          value.components.map((item) => [
            escapeText(item.name),
            item.mounts + item.updates,
            item.mounts,
            item.updates,
          ]),
        ),
    ...(value.sources.length === 0
      ? []
      : [
          'Script positions, not source-mapped:',
          value.sources
            .map(
              (source) =>
                `- ${escapeText(source.component)}: ${escapeText(`${source.script}:${source.line}:${source.column}`)}`,
            )
            .join('\n'),
        ]),
  ].join('\n\n');
}

function changes(base: ReactEvidence, candidate: ReactEvidence): string {
  const rows = renderChanges(base, candidate);

  return rows.length === 0
    ? 'Each component rendered the same number of times before and after.'
    : table(
        ['Component', 'Before', 'After', 'Change'],
        rows.map((row) => {
          const delta = row.candidate - row.base;

          return [
            escapeText(row.name),
            row.base,
            row.candidate,
            delta > 0 ? `\\+${delta} added` : `${-delta} removed`,
          ];
        }),
      );
}

export const react: MarkdownSection<'react'> = ({ base, candidate }) => {
  const before = base?.evidence;
  const after = candidate.evidence;

  return [
    'Counted in a separate browser run with React DevTools enabled. A render counts when React commits work for the component during the steps; renders React discards after bailing out do not. Components that share a name are summed. These counts are not timing measurements.',
    ...(before?.status === 'recorded' && after.status === 'recorded'
      ? ['### Render changes', changes(before.value, after.value)]
      : []),
    ...(base === null ? [] : ['### Base · before', describe(base)]),
    `### ${base === null ? 'Current capture' : 'Candidate · after'}`,
    describe(candidate),
  ].join('\n\n');
};
