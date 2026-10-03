import type { LineRange } from '../evidence-kinds/coverage';
import { escapeText } from '../markdown';
import type { MarkdownSection, SectionSide } from './define';

export const lineCount = (ranges: readonly LineRange[]) =>
  ranges.reduce((total, [start, end]) => total + end - start + 1, 0);

function describe(side: SectionSide<'coverage'>): string {
  if (side.evidence.status === 'unavailable') {
    return `Unavailable: ${escapeText(side.evidence.reason)}`;
  }

  const { files, scripts } = side.evidence.value;
  const missing = scripts.flatMap((script) =>
    script.kind === 'unavailable'
      ? [`- ${escapeText(script.script)}: ${escapeText(script.reason)}`]
      : script.excluded.map(
          (file) =>
            `- ${escapeText(file.path)} in ${escapeText(script.script)}: ${escapeText(file.reason)}`,
        ),
  );

  return [
    files.length === 0
      ? 'No file in the source snapshot has coverage.'
      : [
          '| File | Lines that ran | Lines that did not run |',
          '| --- | --- | --- |',
          ...files.map(
            (file) =>
              `| ${escapeText(file.path)} | ${lineCount(file.executed)} | ${lineCount(file.unexecuted)} |`,
          ),
        ].join('\n'),
    ...(missing.length === 0 ? [] : ['Without coverage:', missing.join('\n')]),
  ].join('\n\n');
}

export const coverage: MarkdownSection<'coverage'> = ({ base, candidate }) =>
  [
    ...(base === null ? [] : ['### Base · before', describe(base)]),
    `### ${base === null ? 'Current capture' : 'Candidate · after'}`,
    describe(candidate),
  ].join('\n\n');
