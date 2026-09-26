import { DateTime, Effect, Option, Schema } from 'effect';

export const text = Schema.NonEmptyString.check(Schema.isTrimmed());

export const httpOriginSchema = text.check(
  Schema.makeFilter(
    (value) => {
      const url = URL.parse(value);

      return (
        url !== null &&
        ['http:', 'https:'].includes(url.protocol) &&
        url.origin === value
      );
    },
    { message: 'Expected an HTTP(S) origin without a path or credentials' },
  ),
);

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

export const commitSchema = Schema.String.check(
  Schema.isPattern(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/),
);

const commitIdentity = Schema.Struct({
  kind: Schema.Literal('commit'),
  commit: commitSchema,
});

const unavailableReason = Schema.Struct({
  kind: Schema.Literal('unavailable'),
  reason: text,
});

export const captureArtifactSchema = Schema.Struct({
  id: text,
  path: text,
  description: text,
  sha256: digest,
});

export const sourceSchema = Schema.Struct({
  kind: Schema.Literal('snapshot'),
  sha256: digest,
  entry: text,
  revision: Schema.Union([
    commitIdentity,
    Schema.Struct({
      kind: Schema.Literal('worktree'),
      head: Schema.Union([commitIdentity, unavailableReason]),
    }),
  ]),
  files: Schema.NonEmptyArray(
    Schema.Struct({
      path: text,
      sha256: digest,
      executable: Schema.optionalKey(Schema.Boolean),
    }),
  ),
});

export const sourceFailureSchema = Schema.Struct({
  revision: text,
  reason: text,
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
      'configuration',
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
  inputsHash: digest,
  dependenciesHash: Schema.NullOr(digest),
});

export const observedSchema = Schema.Struct({
  version: text,
  source: Schema.Union([
    Schema.Struct({
      kind: Schema.Literal('git'),
      commit: commitSchema,
      trackedChanges: Schema.Boolean,
    }),
    unavailableReason,
  ]),
});

export const captureSchemaVersion = 4;

export const captureSchema = Schema.Struct({
  schemaVersion: Schema.Literal(captureSchemaVersion),
  kind: Schema.Literal('capture'),
  id: text,
  label: text,
  application: text,
  source: sourceSchema,
  recipe: Schema.Struct({ id: text, sha256: digest }),
  producer: Schema.Struct({ name: text, version: text }),
  observed: observedSchema,
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
  artifacts: Schema.Array(captureArtifactSchema),
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
  schemaVersion: Schema.Literal(2),
  requests: Schema.Array(
    Schema.Struct({
      method: text,
      origin: Schema.Union([Schema.Literal('application'), httpOriginSchema]),
      path: text,
      status: count,
      startedAt: timestamp,
    }),
  ),
  browserErrors: Schema.Array(Schema.String),
  text: Schema.optionalKey(
    Schema.Struct({
      selector: text,
      count,
      value: Schema.NullOr(Schema.String),
    }),
  ),
  window: Schema.Struct({ startedAt: timestamp, finishedAt: timestamp }),
});

export type Capture = typeof captureSchema.Type;

export type Source = typeof sourceSchema.Type;

export type Observed = typeof observedSchema.Type;

export type Conditions = typeof conditionsSchema.Type;

export type Observations = typeof observationsSchema.Type;

export type CaptureArtifact = Capture['artifacts'][number];

export class UnsupportedCapture extends Schema.TaggedError<UnsupportedCapture>()(
  'UnsupportedCapture',
  { message: Schema.String },
) {}

const manifestVersion = Schema.fromJsonString(
  Schema.Struct({ kind: Schema.Literal('capture'), schemaVersion: Schema.Int }),
);

const decodeCapture = Schema.decodeUnknownEffect(
  Schema.fromJsonString(captureSchema),
  { onExcessProperty: 'error' },
);

export const parseCapture = Effect.fnUntraced(function* (input: string) {
  const version = Schema.decodeUnknownOption(manifestVersion)(input);

  if (
    Option.isSome(version) &&
    version.value.schemaVersion !== captureSchemaVersion
  ) {
    return yield* new UnsupportedCapture({
      message: `Capture manifest schema version ${version.value.schemaVersion} is unsupported. This Observed reads version ${captureSchemaVersion}, which records the Observed version and the worktree HEAD. Capture this revision again.`,
    });
  }

  return yield* decodeCapture(input);
});

export const parseObservations = Schema.decodeUnknownEffect(
  Schema.fromJsonString(observationsSchema),
  { onExcessProperty: 'error' },
);
