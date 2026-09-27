import { Effect, Schema } from 'effect';
import path from 'node:path';
import {
  playwrightOutcomes,
  playwrightStatuses,
  type PlaywrightTest,
  type PlaywrightValue,
} from '../evidence-kinds/playwright';
import { readZip } from './zip';

export class PlaywrightReportError extends Schema.TaggedError<PlaywrightReportError>()(
  'PlaywrightReportError',
  { message: Schema.String },
) {}

// Where an attachment's bytes are before Observed copies them. Paths are
// report data: the caller decides whether a path is acceptable.
export type AttachmentSource =
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'inline' }
  | { readonly kind: 'missing' };

export type ReportAttachment = {
  readonly name: string;
  readonly contentType: string;
  readonly source: AttachmentSource;
};

export type ReportTest = Omit<PlaywrightTest, 'source' | 'results'> & {
  // Absolute path of the test file where the report was written, when the
  // report records it.
  readonly absoluteFile: string | null;
  readonly results: readonly (Omit<
    PlaywrightTest['results'][number],
    'attachments'
  > & { readonly attachments: readonly ReportAttachment[] })[];
};

export type ParsedReport = Omit<PlaywrightValue, 'tests' | 'exitCode'> & {
  readonly tests: readonly ReportTest[];
};

const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const status = Schema.Literals(playwrightStatuses);
const outcome = Schema.Literals(playwrightOutcomes);
const errorSchema = Schema.Union([
  Schema.String,
  Schema.Struct({
    message: Schema.optionalKey(Schema.String),
    value: Schema.optionalKey(Schema.String),
  }),
]);
const annotationSchema = Schema.Struct({
  type: Schema.String,
  description: Schema.optionalKey(Schema.String),
});
const attachmentSchema = Schema.Struct({
  name: Schema.String,
  contentType: Schema.String,
  path: Schema.optionalKey(Schema.String),
  body: Schema.optionalKey(Schema.Unknown),
});
const resultSchema = Schema.Struct({
  retry: count,
  status,
  duration: Schema.Finite,
  startTime: Schema.String,
  errors: Schema.Array(errorSchema),
  attachments: Schema.Array(attachmentSchema),
});

// The JSON reporter's documented shape (JSONReport in
// @playwright/test/reporter). Unread fields are ignored.
type JsonSuite = {
  readonly title: string;
  readonly specs: readonly (typeof jsonSpecSchema.Type)[];
  readonly suites?: readonly JsonSuite[];
};

const jsonSpecSchema = Schema.Struct({
  title: Schema.String,
  file: Schema.String,
  line: count,
  tests: Schema.Array(
    Schema.Struct({
      projectName: Schema.String,
      expectedStatus: status,
      status: outcome,
      annotations: Schema.Array(annotationSchema),
      results: Schema.Array(resultSchema),
    }),
  ),
});

const jsonSuiteSchema: Schema.Codec<JsonSuite> = Schema.Struct({
  title: Schema.String,
  specs: Schema.Array(jsonSpecSchema),
  suites: Schema.optionalKey(
    Schema.Array(
      Schema.suspend((): Schema.Codec<JsonSuite> => jsonSuiteSchema),
    ),
  ),
});

const jsonReportSchema = Schema.Struct({
  config: Schema.Struct({
    version: Schema.String,
    rootDir: Schema.String,
    projects: Schema.Array(Schema.Struct({ name: Schema.String })),
  }),
  suites: Schema.Array(jsonSuiteSchema),
  errors: Schema.Array(errorSchema),
  stats: Schema.Struct({
    startTime: Schema.String,
    duration: Schema.Finite,
    expected: count,
    unexpected: count,
    flaky: count,
    skipped: count,
  }),
});

// The HTML reporter's embedded data. It is internal to Playwright, so a
// report that doesn't match is rejected rather than guessed at.
const htmlTestSchema = Schema.Struct({
  title: Schema.String,
  projectName: Schema.String,
  location: Schema.Struct({ file: Schema.String, line: count }),
  path: Schema.Array(Schema.String),
  outcome,
  annotations: Schema.Array(annotationSchema),
  results: Schema.Array(resultSchema),
});

const htmlFileSchema = Schema.Struct({
  fileId: Schema.String,
  tests: Schema.Array(htmlTestSchema),
});

const htmlReportSchema = Schema.Struct({
  startTime: Schema.Finite,
  duration: Schema.Finite,
  projectNames: Schema.Array(Schema.String),
  errors: Schema.Array(errorSchema),
  stats: Schema.Struct({
    total: count,
    expected: count,
    unexpected: count,
    flaky: count,
    skipped: count,
  }),
  files: Schema.Array(Schema.Struct({ fileId: Schema.String })),
});

const decode = <S extends Schema.Codec<unknown, unknown>>(
  schema: S,
  what: string,
) => {
  const parse = Schema.decodeUnknownEffect(Schema.fromJsonString(schema));

  return (input: string) =>
    parse(input).pipe(
      Effect.mapError(
        () =>
          new PlaywrightReportError({
            message: `${what} is not a Playwright report this Observed reads`,
          }),
      ),
    );
};

// Terminal color codes Playwright puts in error messages.
// eslint-disable-next-line no-control-regex
const ansi = /\u001b\[[0-9;]*m/g;

function errorText(error: typeof errorSchema.Type): string {
  const message =
    typeof error === 'string' ? error : (error.message ?? error.value ?? '');

  return message.replace(ansi, '');
}

function annotations(
  items: readonly (typeof annotationSchema.Type)[],
): PlaywrightTest['annotations'] {
  return items.map((item) => ({
    type: item.type,
    description: item.description ?? null,
  }));
}

function results(
  items: readonly (typeof resultSchema.Type)[],
  resolve: (attachment: typeof attachmentSchema.Type) => AttachmentSource,
): ReportTest['results'] {
  return items.map((item) => {
    const [first] = item.errors;

    return {
      retry: item.retry,
      status: item.status,
      duration: item.duration,
      startedAt: item.startTime,
      error: first === undefined ? null : errorText(first),
      attachments: item.attachments.map((attachment) => ({
        name: attachment.name,
        contentType: attachment.contentType,
        source: resolve(attachment),
      })),
    };
  });
}

function source(
  attachment: typeof attachmentSchema.Type,
  resolve: (file: string) => string,
): AttachmentSource {
  if (attachment.path !== undefined) {
    return { kind: 'file', path: resolve(attachment.path) };
  }

  return attachment.body === undefined
    ? { kind: 'missing' }
    : { kind: 'inline' };
}

// Repeated runs of one test (repeatEach) share a title; number them so each
// keeps its own ID.
function withIds(
  tests: readonly Omit<ReportTest, 'id'>[],
): readonly ReportTest[] {
  const seen = new Map<string, number>();

  return tests.map((test) => {
    const base = [test.project, test.file, ...test.titlePath]
      .filter((part) => part !== '')
      .join(' › ');
    const index = (seen.get(base) ?? 0) + 1;
    seen.set(base, index);

    return { ...test, id: index === 1 ? base : `${base} (${index})` };
  });
}

export const parseJsonReport = Effect.fnUntraced(function* (input: string) {
  const report = yield* decode(jsonReportSchema, 'The JSON file')(input);
  const tests: Omit<ReportTest, 'id'>[] = [];

  const walk = (suite: JsonSuite, describe: readonly string[]) => {
    for (const spec of suite.specs) {
      for (const item of spec.tests) {
        tests.push({
          project: item.projectName,
          file: spec.file,
          absoluteFile: path.resolve(report.config.rootDir, spec.file),
          line: spec.line,
          titlePath: [...describe, spec.title],
          outcome: item.status,
          expectedStatus: item.expectedStatus,
          annotations: annotations(item.annotations),
          results: results(item.results, (attachment) =>
            source(attachment, (file) => file),
          ),
        });
      }
    }

    for (const child of suite.suites ?? []) {
      walk(child, [...describe, child.title]);
    }
  };

  // Top-level suites are test files; their titles are not part of a test's
  // title path.
  for (const suite of report.suites) {
    walk(suite, []);
  }

  const { startTime, duration, expected, unexpected, flaky, skipped } =
    report.stats;

  return {
    report: 'json',
    version: report.config.version === '' ? null : report.config.version,
    startedAt: startTime,
    duration,
    projects: report.config.projects.map((project) => project.name),
    errors: report.errors.map(errorText),
    stats: { expected, unexpected, flaky, skipped },
    tests: withIds(tests),
  } satisfies ParsedReport;
});

const embedded =
  /<script id="playwrightReportBase64" type="application\/zip">data:application\/zip;base64,([A-Za-z0-9+/=]*)<\/script>/;

// Reads the data an HTML report embeds in its index.html. Attachment paths
// in it are relative to the report directory.
export const parseHtmlReport = Effect.fnUntraced(function* (
  indexHtml: string,
  directory: string,
) {
  const match = embedded.exec(indexHtml);

  if (match?.[1] === undefined) {
    return yield* new PlaywrightReportError({
      message: 'index.html holds no embedded Playwright report data',
    });
  }

  const encoded = match[1];
  const files = yield* Effect.try({
    try: () => readZip(Uint8Array.fromBase64(encoded), 256 * 1024 * 1024),
    catch: (cause) =>
      new PlaywrightReportError({
        message: `The embedded report data is not a readable zip: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });
  const read = (name: string) =>
    Effect.try({
      try: () => {
        const entry = files.get(name);

        if (entry === undefined) {
          throw new Error(`${name} is missing`);
        }

        return new TextDecoder('utf-8', { fatal: true }).decode(entry.read());
      },
      catch: (cause) =>
        new PlaywrightReportError({
          message: `The embedded report data is incomplete: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });
  const report = yield* decode(
    htmlReportSchema,
    'The embedded report.json',
  )(yield* read('report.json'));
  const tests: Omit<ReportTest, 'id'>[] = [];

  for (const { fileId } of report.files) {
    const file = yield* decode(
      htmlFileSchema,
      `The embedded ${fileId}.json`,
    )(yield* read(`${fileId}.json`));

    for (const item of file.tests) {
      tests.push({
        project: item.projectName,
        file: item.location.file,
        absoluteFile: null,
        line: item.location.line,
        titlePath: [...item.path.filter((title) => title !== ''), item.title],
        outcome: item.outcome,
        expectedStatus: null,
        annotations: annotations(item.annotations),
        results: results(item.results, (attachment) =>
          source(attachment, (file) => path.resolve(directory, file)),
        ),
      });
    }
  }

  const { expected, unexpected, flaky, skipped } = report.stats;

  return {
    report: 'html',
    version: null,
    startedAt: Number.isNaN(new Date(report.startTime).getTime())
      ? null
      : new Date(report.startTime).toISOString(),
    duration: report.duration,
    projects: report.projectNames,
    errors: report.errors.map(errorText),
    stats: { expected, unexpected, flaky, skipped },
    tests: withIds(tests),
  } satisfies ParsedReport;
});
