import type { SideArtifact } from '../comparison-model';
import type {
  PlaywrightAttachment,
  PlaywrightTest,
  PlaywrightValue,
} from '../evidence-kinds/playwright';
import { escapeText, link } from '../markdown';
import {
  attachmentFile,
  describeRun,
  describeTrace,
  firstLine,
  notableTests,
  outcomeLabels,
  playwrightClaimLimit,
  removedTests,
  showTraceCommand,
  summarizeError,
  testTitle,
} from '../playwright-text';
import type { MarkdownSection, SectionSide } from './define';

function code(value: string): string {
  return value.includes('`') ? escapeText(value) : `\`${value}\``;
}

function attachment(
  item: PlaywrightAttachment,
  artifacts: readonly SideArtifact[],
): string {
  const file = attachmentFile(item, artifacts);

  if (file.kind === 'unavailable') {
    return `${escapeText(item.name)} unavailable: ${escapeText(file.reason)}`;
  }

  return item.trace === null
    ? link(item.name, file.path)
    : `${link(item.name, file.path)}, open with ${code(showTraceCommand(file.path))} from the report's directory. ${escapeText(describeTrace(item.trace))}`;
}

function test(item: PlaywrightTest, artifacts: readonly SideArtifact[]) {
  return [
    `- **${outcomeLabels[item.outcome]}**: ${escapeText(testTitle(item))}`,
    ...item.results.flatMap((result) => [
      `  - Attempt ${result.retry + 1}: ${escapeText(result.status)}${result.error === null ? '' : `. ${escapeText(summarizeError(result.error))}`}`,
      ...result.attachments.map(
        (file) => `    - ${attachment(file, artifacts)}`,
      ),
    ]),
  ].join('\n');
}

function describe(
  side: SectionSide<'playwright'>,
  base: PlaywrightValue | null,
): string {
  if (side.evidence.status === 'unavailable') {
    return `Playwright tests unavailable: ${escapeText(side.evidence.reason)}`;
  }

  const value = side.evidence.value;
  const listed = notableTests(value);
  const removed = removedTests(base, value);

  return [
    escapeText(describeRun(value)),
    ...value.errors.map(
      (error) => `- Error outside any test: ${escapeText(firstLine(error))}`,
    ),
    listed.length === 0
      ? 'Every test passed on its first attempt, with no attachments.'
      : listed.map((item) => test(item, side.artifacts)).join('\n'),
    ...(removed.length === 0
      ? []
      : [
          `Tests on base that this run did not report: ${removed.map((item) => escapeText(testTitle(item))).join('; ')}.`,
        ]),
  ].join('\n\n');
}

function recorded(side: SectionSide<'playwright'> | null) {
  return side?.evidence.status === 'recorded' ? side.evidence.value : null;
}

export const playwright: MarkdownSection<'playwright'> = ({
  base,
  candidate,
}) =>
  [
    escapeText(playwrightClaimLimit),
    ...(base === null ? [] : ['### Base · before', describe(base, null)]),
    `### ${base === null ? 'Current capture' : 'Candidate · after'}`,
    describe(candidate, recorded(base)),
  ].join('\n\n');
