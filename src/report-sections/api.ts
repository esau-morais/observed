import {
  apiClaimLimit,
  apiRows,
  describeContract,
  describeResponse,
  describeStatusChange,
  incomparableNotice,
  recordFile,
} from '../api-text';
import { escapeText, link } from '../markdown';
import type { MarkdownSection, SectionSide } from './define';

function file(label: string, side: SectionSide<'api'> | null): string[] {
  if (side === null || side.evidence.status === 'unavailable') {
    return [];
  }

  const record = recordFile(side.artifacts);

  return [
    record.kind === 'recorded'
      ? `- ${link(`${label}: requests and responses`, record.path)}`
      : `- ${escapeText(`${label}: requests and responses unavailable. ${record.reason}`)}`,
  ];
}

export const api: MarkdownSection<'api'> = ({
  base,
  candidate,
  comparable,
}) => {
  const current = base === null ? 'Current capture' : 'After';
  const unavailable = [
    { label: 'Before', view: base?.evidence ?? null },
    { label: current, view: candidate.evidence },
  ].flatMap(({ label, view }) =>
    view?.status === 'unavailable'
      ? [`- ${escapeText(`${label}: operations unavailable. ${view.reason}`)}`]
      : [],
  );
  const operations = apiRows({
    base: base?.evidence ?? null,
    candidate: candidate.evidence,
    comparable,
  }).map((row) => {
    const status = describeStatusChange(row);
    const lines = [
      ...(base === null
        ? []
        : [`Before: ${escapeText(describeResponse(row.base))}`]),
      `${current}: ${escapeText(describeResponse(row.candidate))}`,
      ...(status === null ? [] : [escapeText(status)]),
      ...(row.contract === null
        ? []
        : describeContract(row.contract).map(escapeText)),
    ];

    return [
      `- ${escapeText(`${row.id} · ${row.request}`)}`,
      ...lines.map((line) => `  - ${line}`),
    ].join('\n');
  });
  const files = [...file('Before', base), ...file(current, candidate)];

  return [
    escapeText(apiClaimLimit),
    ...(base === null || comparable ? [] : [escapeText(incomparableNotice)]),
    ...(operations.length === 0 ? [] : [operations.join('\n')]),
    ...unavailable,
    ...(files.length === 0 ? [] : [files.join('\n')]),
  ].join('\n\n');
};
