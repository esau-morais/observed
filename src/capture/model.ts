import { DateTime, Option, Schema } from 'effect';

export const text = Schema.NonEmptyString.check(Schema.isTrimmed());

export const digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));

export const timestamp = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
  Schema.makeFilter((value) => {
    const parsed = DateTime.make(value);

    return Option.isSome(parsed) && DateTime.formatIso(parsed.value) === value;
  }),
);

const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const positive = Schema.Int.check(Schema.isGreaterThan(0));

const artifact = Schema.Struct({
  id: text,
  path: text,
  description: text,
  sha256: digest,
});

export const sourceSchema = Schema.Struct({
  kind: Schema.Literal('snapshot'),
  sha256: digest,
  entry: text,
  files: Schema.NonEmptyArray(Schema.Struct({ path: text, sha256: digest })),
});

const execution = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('complete') }),
  Schema.Struct({
    kind: Schema.Literal('failed'),
    category: Schema.Literals([
      'timeout',
      'cancelled',
      'producer',
      'application',
      'cleanup',
    ]),
    reason: text,
  }),
]);

export const conditionsSchema = Schema.Struct({
  browser: text,
  platform: text,
  bun: text,
  viewport: Schema.Struct({
    width: positive,
    height: positive,
    scale: positive,
  }),
  colorScheme: Schema.Literal('light'),
  locale: text,
  timezone: text,
  fixtureHash: digest,
  lockfileHash: digest,
});

export const captureSchema = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  kind: Schema.Literal('capture'),
  id: text,
  label: text,
  application: text,
  source: sourceSchema,
  recipe: Schema.Struct({ id: text, sha256: digest }),
  producer: Schema.Struct({ name: text, version: text }),
  conditions: Schema.Union([
    Schema.Struct({
      kind: Schema.Literal('recorded'),
      value: conditionsSchema,
    }),
    Schema.Struct({ kind: Schema.Literal('unavailable'), reason: text }),
  ]),
  startedAt: timestamp,
  finishedAt: timestamp,
  execution,
  artifacts: Schema.Array(artifact),
}).check(
  Schema.makeFilter((capture) => {
    const issues: Schema.FilterIssue[] = [];

    if (capture.finishedAt < capture.startedAt) {
      issues.push('Capture finishes before it starts');
    }

    if (
      new Set(capture.artifacts.map((item) => item.id)).size !==
      capture.artifacts.length
    ) {
      issues.push('Duplicate artifact IDs');
    }

    if (
      new Set(capture.artifacts.map((item) => item.path)).size !==
      capture.artifacts.length
    ) {
      issues.push('Duplicate artifact paths');
    }

    if (
      new Set(capture.source.files.map((item) => item.path)).size !==
      capture.source.files.length
    ) {
      issues.push('Duplicate source paths');
    }

    return issues;
  }),
);

export const observationsSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  requests: Schema.Array(
    Schema.Struct({
      method: text,
      path: text,
      status: count,
      startedAt: timestamp,
    }),
  ),
  browserErrors: Schema.Array(Schema.String),
  window: Schema.Struct({ startedAt: timestamp, finishedAt: timestamp }),
});

export type Capture = typeof captureSchema.Type;

export type Source = typeof sourceSchema.Type;

export type Conditions = typeof conditionsSchema.Type;

export type Observations = typeof observationsSchema.Type;

export type CaptureArtifact = Capture['artifacts'][number];

export const parseCapture = Schema.decodeUnknownEffect(
  Schema.fromJsonString(captureSchema),
  { onExcessProperty: 'error' },
);

export const parseObservations = Schema.decodeUnknownEffect(
  Schema.fromJsonString(observationsSchema),
  { onExcessProperty: 'error' },
);
