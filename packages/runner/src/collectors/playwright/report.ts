import { Effect, Schema } from 'effect';
import path from 'node:path';
import {
  playwrightOutcomes,
  playwrightStatuses,
  type PlaywrightTest,
  type PlaywrightValue,
} from '@observed/judge';

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
  readonly results: readonly (Omit<PlaywrightTest['results'][number], 'attachments'> & {
    readonly attachments: readonly ReportAttachment[];
  })[];
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
    Schema.Array(Schema.suspend((): Schema.Codec<JsonSuite> => jsonSuiteSchema)),
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

const decode = <S extends Schema.Codec<unknown, unknown>>(schema: S, what: string) => {
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
  const message = typeof error === 'string' ? error : (error.message ?? error.value ?? '');

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

function results(items: readonly (typeof resultSchema.Type)[]): ReportTest['results'] {
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
        source: source(attachment),
      })),
    };
  });
}

function source(attachment: typeof attachmentSchema.Type): AttachmentSource {
  if (attachment.path !== undefined) {
    return { kind: 'file', path: attachment.path };
  }

  return attachment.body === undefined ? { kind: 'missing' } : { kind: 'inline' };
}

// Repeated runs of one test (repeatEach) share a title; number them so each
// keeps its own ID.
function withIds(tests: readonly Omit<ReportTest, 'id'>[]): readonly ReportTest[] {
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
          results: results(item.results),
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

  const { startTime, duration, expected, unexpected, flaky, skipped } = report.stats;

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
