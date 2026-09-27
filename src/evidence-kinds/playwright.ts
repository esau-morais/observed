import { Schema } from 'effect';
import { text } from '../capture/model';
import { defineEvidence } from './define';

const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const duration = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0),
);

export const playwrightStatuses = [
  'passed',
  'failed',
  'timedOut',
  'skipped',
  'interrupted',
] as const;

// Playwright's own classification of a test across its retries.
export const playwrightOutcomes = [
  'expected',
  'unexpected',
  'flaky',
  'skipped',
] as const;

const status = Schema.Literals(playwrightStatuses);

const file = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('recorded'), artifact: text }),
  Schema.Struct({ kind: Schema.Literal('unavailable'), reason: text }),
]);

// Read from the trace's own context-options event. It records no browser
// version: its user agent comes from the test's device settings.
const trace = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('recorded'),
    title: Schema.NullOr(Schema.String),
    browser: Schema.String,
    channel: Schema.NullOr(Schema.String),
    playwrightVersion: Schema.String,
    platform: Schema.String,
    viewport: Schema.NullOr(Schema.Struct({ width: count, height: count })),
  }),
  Schema.Struct({ kind: Schema.Literal('unavailable'), reason: text }),
]);

const attachment = Schema.Struct({
  name: Schema.String,
  contentType: Schema.String,
  file,
  trace: Schema.NullOr(trace),
});

const result = Schema.Struct({
  retry: count,
  status,
  duration,
  startedAt: Schema.String,
  error: Schema.NullOr(Schema.String),
  attachments: Schema.Array(attachment),
});

const test = Schema.Struct({
  id: text,
  project: Schema.String,
  file: text,
  // The test file relative to the captured app, when Observed ran the
  // command and the file is inside the app.
  source: Schema.NullOr(text),
  line: count,
  titlePath: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
  outcome: Schema.Literals(playwrightOutcomes),
  // The HTML report does not record it.
  expectedStatus: Schema.NullOr(status),
  annotations: Schema.Array(
    Schema.Struct({
      type: Schema.String,
      description: Schema.NullOr(Schema.String),
    }),
  ),
  results: Schema.Array(result),
});

export const playwrightValueSchema = Schema.Struct({
  report: Schema.Literals(['json', 'html']),
  version: Schema.NullOr(text),
  // Null when Observed imported a report instead of running the command.
  exitCode: Schema.NullOr(Schema.Int),
  startedAt: Schema.NullOr(Schema.String),
  duration,
  projects: Schema.Array(Schema.String),
  errors: Schema.Array(Schema.String),
  stats: Schema.Struct({
    expected: count,
    unexpected: count,
    flaky: count,
    skipped: count,
  }),
  tests: Schema.Array(test),
}).check(
  Schema.makeFilter(
    (value) =>
      new Set(value.tests.map((item) => item.id)).size === value.tests.length &&
      playwrightOutcomes.every(
        (outcome) =>
          value.tests.filter((item) => item.outcome === outcome).length ===
          value.stats[outcome],
      ),
    {
      message:
        'Test IDs must be unique and the tests must match the reported counts',
    },
  ),
);

export type PlaywrightValue = typeof playwrightValueSchema.Type;

export type PlaywrightTest = PlaywrightValue['tests'][number];

export type PlaywrightAttachment =
  PlaywrightTest['results'][number]['attachments'][number];

export const playwright = defineEvidence({
  kind: 'playwright',
  title: 'Playwright tests',
  schemaVersion: 1,
  collector: {
    command: Schema.NonEmptyArray(text),
    // Variables the command also receives, such as a test account's
    // password. Their values are concealed in evidence.
    environment: Schema.optionalKey(
      Schema.Array(
        text.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/)),
      ).check(Schema.isUnique()),
    ),
  },
  value: playwrightValueSchema,
});
