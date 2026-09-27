import { escapeText, link } from '../markdown';
import {
  describeConditions,
  inspectionFiles,
  inspectionNote,
  performanceClaimLimit,
  performanceRows,
  type InspectionFile,
  type PerformanceCell,
} from '../performance-text';
import type { MarkdownSection, SectionSide } from './define';

function cell(value: PerformanceCell | null): string {
  if (value === null) {
    return '';
  }

  return escapeText(
    value.kind === 'measured' ? `${value.median} (${value.range})` : value.text,
  );
}

function file(label: string, value: InspectionFile): string {
  return value.kind === 'recorded'
    ? link(label, value.path)
    : `${escapeText(label)} unavailable: ${escapeText(value.reason)}`;
}

function inspection(
  label: string,
  side: SectionSide<'performance'> | null,
): string[] {
  const files =
    side === null ? null : inspectionFiles(side.evidence, side.artifacts);

  return files === null
    ? []
    : [
        `- ${escapeText(label)}: ${file('DevTools trace', files.trace)} · ${file('DevTools profile', files.profile)}`,
      ];
}

export const performance: MarkdownSection<'performance'> = ({
  base,
  candidate,
}) => {
  const before = base?.evidence ?? null;
  const after = candidate.evidence;
  const current = base === null ? 'Current capture' : 'After';
  const columns =
    base === null
      ? ['Metric', 'Median (range)']
      : ['Metric', 'Before: median (range)', 'After: median (range)', 'Change'];
  const rows = performanceRows(before, after).map((row) => {
    const metric = escapeText(`${row.abbreviation} · ${row.label}`);

    return base === null
      ? `| ${metric} | ${cell(row.candidate)} |`
      : `| ${metric} | ${cell(row.base)} | ${cell(row.candidate)} | ${escapeText(row.change)} |`;
  });
  const unavailable = [
    { label: 'Before', view: before },
    { label: current, view: after },
  ].flatMap(({ label, view }) =>
    view?.status === 'unavailable'
      ? [`- ${escapeText(`${label}: samples unavailable. ${view.reason}`)}`]
      : [],
  );
  const files = [
    ...inspection('Before', base),
    ...inspection(current, candidate),
  ];

  return [
    escapeText(performanceClaimLimit),
    escapeText(describeConditions(before, after)),
    [
      `| ${columns.join(' | ')} |`,
      `| ${columns.map(() => '---').join(' | ')} |`,
      ...rows,
    ].join('\n'),
    ...unavailable,
    ...(files.length === 0
      ? []
      : [escapeText(inspectionNote), files.join('\n')]),
  ].join('\n\n');
};
