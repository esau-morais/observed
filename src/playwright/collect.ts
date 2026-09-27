import { Effect, FileSystem } from 'effect';
import path from 'node:path';
import type {
  PlaywrightAttachment,
  PlaywrightValue,
} from '../evidence-kinds/playwright';
import type { ParsedReport, ReportAttachment } from './report';
import { summarizeTrace } from './trace';

export type AddArtifact = (
  id: string,
  filename: string,
  description: string,
) => void;

function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file);

  return (
    relative !== '' &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  );
}

function safeName(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');

  return safe === '' ? 'attachment' : safe;
}

// Copies one attachment into the bundle. Report paths are data, so a file
// outside `root`, including through a symlink, is never read.
const copyAttachment = Effect.fnUntraced(function* (options: {
  attachment: ReportAttachment;
  root: string;
  directory: string;
  filename: string;
  id: string;
  description: string;
  addArtifact: AddArtifact;
}) {
  const fs = yield* FileSystem.FileSystem;
  const { attachment } = options;
  const unavailable = (reason: string): PlaywrightAttachment => ({
    name: attachment.name,
    contentType: attachment.contentType,
    file: { kind: 'unavailable', reason },
    trace: null,
  });

  if (attachment.source.kind === 'inline') {
    return unavailable(
      'The report holds this attachment inline; Observed keeps only file attachments',
    );
  }

  if (attachment.source.kind === 'missing') {
    return unavailable('The report names no file for this attachment');
  }

  const source = yield* fs.realPath(attachment.source.path).pipe(Effect.option);

  if (source._tag === 'None') {
    return unavailable('The attachment file does not exist');
  }

  if (!inside(options.root, source.value)) {
    return unavailable(
      `The attachment file is outside ${options.root}, so Observed did not read it`,
    );
  }

  const info = yield* fs.stat(source.value);

  if (info.type !== 'File') {
    return unavailable('The attachment is not a regular file');
  }

  const bytes = yield* fs.readFile(source.value);
  const destination = path.join(options.directory, options.filename);

  yield* fs.makeDirectory(path.dirname(destination), { recursive: true });
  yield* fs.writeFile(destination, bytes, { flag: 'wx' });
  options.addArtifact(options.id, options.filename, options.description);

  return {
    name: attachment.name,
    contentType: attachment.contentType,
    file: { kind: 'recorded', artifact: options.id },
    trace:
      attachment.name === 'trace' &&
      attachment.contentType === 'application/zip'
        ? summarizeTrace(bytes)
        : null,
  } satisfies PlaywrightAttachment;
});

// Turns a parsed report into the evidence value, copying attachments under
// playwright/ in `directory`. `root` must be a real path.
export const collectReport = Effect.fnUntraced(function* (options: {
  report: ParsedReport;
  exitCode: number | null;
  root: string;
  // The app directory the command ran in, to name test files relative to it.
  workspace: string | null;
  directory: string;
  addArtifact: AddArtifact;
}) {
  const { report, workspace } = options;
  const tests: PlaywrightValue['tests'][number][] = [];

  for (const [testIndex, test] of report.tests.entries()) {
    const results: PlaywrightValue['tests'][number]['results'][number][] = [];

    for (const result of test.results) {
      const attachments: PlaywrightAttachment[] = [];

      for (const [index, attachment] of result.attachments.entries()) {
        const folder = `playwright/${testIndex + 1}/${result.retry}`;
        const filename =
          attachment.source.kind === 'file'
            ? `${folder}/${index + 1}-${safeName(path.basename(attachment.source.path))}`
            : `${folder}/${index + 1}`;

        attachments.push(
          yield* copyAttachment({
            attachment,
            root: options.root,
            directory: options.directory,
            filename,
            id: `playwright-${testIndex + 1}-${result.retry}-${index + 1}`,
            description: `Playwright ${attachment.name} for "${test.titlePath.join(' › ')}", attempt ${result.retry + 1}, copied unchanged`,
            addArtifact: options.addArtifact,
          }),
        );
      }

      results.push({ ...result, attachments });
    }

    tests.push({
      id: test.id,
      project: test.project,
      file: test.file,
      source:
        workspace !== null &&
        test.absoluteFile !== null &&
        inside(workspace, test.absoluteFile)
          ? path
              .relative(workspace, test.absoluteFile)
              .split(path.sep)
              .join('/')
          : null,
      line: test.line,
      titlePath: test.titlePath,
      outcome: test.outcome,
      expectedStatus: test.expectedStatus,
      annotations: test.annotations,
      results,
    });
  }

  const traceVersions = new Set(
    tests.flatMap((test) =>
      test.results.flatMap((result) =>
        result.attachments.flatMap((attachment) =>
          attachment.trace?.kind === 'recorded'
            ? [attachment.trace.playwrightVersion]
            : [],
        ),
      ),
    ),
  );
  const [traceVersion] = traceVersions;

  return {
    report: report.report,
    version:
      report.version ??
      (traceVersions.size === 1 && traceVersion !== undefined
        ? traceVersion
        : null),
    exitCode: options.exitCode,
    startedAt: report.startedAt,
    duration: report.duration,
    projects: report.projects,
    errors: report.errors,
    stats: report.stats,
    tests,
  } satisfies PlaywrightValue;
});
