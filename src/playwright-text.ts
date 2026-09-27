import type { SideArtifact } from './comparison-model';
import type {
  PlaywrightAttachment,
  PlaywrightTest,
  PlaywrightValue,
} from './evidence-kinds/playwright';

export const playwrightClaimLimit =
  "Imported from Playwright. Observed ran the app's own tests or read their report, and didn't check the assertions itself. A test covers only what it asserts. Flaky and skipped tests are unknown, not passed.";

export const outcomeLabels = {
  expected: 'Passed',
  unexpected: 'Failed',
  flaky: 'Flaky',
  skipped: 'Skipped',
} satisfies Record<PlaywrightTest['outcome'], string>;

export const outcomeTones = {
  expected: 'checked',
  unexpected: 'regression',
  flaky: 'unknown',
  skipped: 'unknown',
} as const satisfies Record<PlaywrightTest['outcome'], string>;

// The assertion line plus Playwright's Expected and Received lines, when the
// message has them.
export function summarizeError(value: string): string {
  const [first = '', ...rest] = value.trim().split('\n');
  const values = rest
    .map((line) => line.trim())
    .filter((line) => /^(?:Expected|Received)(?: [a-z]+)?:/.test(line))
    .map((line) => line.replace(/\s+/g, ' '));

  return values.length === 0 ? first : `${first} (${values.join(', ')})`;
}

export function describeRun(value: PlaywrightValue): string {
  const { expected, unexpected, flaky, skipped } = value.stats;
  const counts = [
    `${expected} passed`,
    `${unexpected} failed`,
    `${flaky} flaky`,
    `${skipped} skipped`,
  ].join(', ');
  const source =
    value.exitCode === null
      ? `Imported from its ${value.report === 'json' ? 'JSON' : 'HTML'} report`
      : `The app's Playwright command exited with code ${value.exitCode}`;

  return `Playwright ${value.version ?? 'version not recorded'}. ${source}. ${counts}${value.projects.length === 0 ? '' : `, in ${value.projects.length === 1 ? 'project' : 'projects'} ${value.projects.join(', ')}`}.`;
}

export function testTitle(test: PlaywrightTest): string {
  return `${test.titlePath.join(' › ')} (${test.file}:${test.line}${test.project === '' ? '' : `, ${test.project}`})`;
}

// Tests worth listing beyond the check list: anything not passed, and any
// test with an attachment to open.
export function notableTests(value: PlaywrightValue): PlaywrightTest[] {
  return value.tests.filter(
    (test) =>
      test.outcome !== 'expected' ||
      test.results.some((result) => result.attachments.length > 0),
  );
}

// Base tests the candidate no longer reports, by ID.
export function removedTests(
  base: PlaywrightValue | null,
  candidate: PlaywrightValue,
): PlaywrightTest[] {
  return base === null
    ? []
    : base.tests.filter(
        (test) => !candidate.tests.some((item) => item.id === test.id),
      );
}

export type AttachmentFile =
  | { readonly kind: 'recorded'; readonly path: string }
  | { readonly kind: 'unavailable'; readonly reason: string };

export function attachmentFile(
  attachment: PlaywrightAttachment,
  artifacts: readonly SideArtifact[],
): AttachmentFile {
  if (attachment.file.kind === 'unavailable') {
    return attachment.file;
  }

  const id = attachment.file.artifact;
  const artifact = artifacts.find((item) => item.id === id);

  if (artifact === undefined) {
    return { kind: 'unavailable', reason: 'The file is not in the capture' };
  }

  return artifact.integrity === 'verified'
    ? { kind: 'recorded', path: artifact.path }
    : { kind: 'unavailable', reason: artifact.reason };
}

// Playwright's own viewer, run from the report's directory. `link` is the
// report-relative link to the verified trace.
export function showTraceCommand(link: string): string {
  const file = link.split('/').map(decodeURIComponent).join('/');
  const quoted = /^[A-Za-z0-9._/-]+$/.test(file)
    ? file
    : `'${file.replaceAll("'", "'\\''")}'`;

  return `npx playwright show-trace ${quoted}`;
}

export function describeTrace(
  trace: NonNullable<PlaywrightAttachment['trace']>,
): string {
  if (trace.kind === 'unavailable') {
    return `Trace summary unavailable: ${trace.reason}.`;
  }

  const browser =
    trace.channel === null
      ? trace.browser
      : `${trace.browser} (${trace.channel})`;
  const viewport =
    trace.viewport === null
      ? ''
      : `, ${trace.viewport.width} × ${trace.viewport.height}`;

  return `Recorded by Playwright ${trace.playwrightVersion} in ${browser} on ${trace.platform}${viewport}.`;
}
