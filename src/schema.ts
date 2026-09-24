import { DateTime, Option, Schema } from 'effect';

const text = Schema.NonEmptyString.check(Schema.isTrimmed());

const id = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/));

const sha256 = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));

const unknown = Schema.Struct({
  kind: Schema.Literal('unknown'),
  reason: text,
});

const timestamp = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/),
  Schema.makeFilter(
    (value) => {
      const parsed = DateTime.make(value);

      return (
        Option.isSome(parsed) &&
        DateTime.formatIso(parsed.value).startsWith(value.slice(0, -1))
      );
    },
    { message: 'Expected a valid UTC calendar timestamp without rollover' },
  ),
).pipe(Schema.decodeTo(Schema.DateTimeUtcFromString));

const recorded = <S extends Schema.Constraint>(value: S) =>
  Schema.Union([
    Schema.Struct({ kind: Schema.Literal('known'), value }),
    unknown,
  ]);

const revision = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('commit'), value: text }),
  Schema.Struct({ kind: Schema.Literal('snapshot'), value: text }),
  unknown,
]);

const artifact = Schema.Struct({
  id,
  path: text,
  description: text,
  sha256: Schema.optionalKey(sha256),
});

const check = Schema.Struct({
  id,
  name: text,
  expectation: text,
  scope: text,
  method: text,
  suppliedBy: text,
  result: Schema.Union([
    Schema.Struct({ kind: Schema.Literal('passed'), detail: text }),
    Schema.Struct({ kind: Schema.Literal('failed'), detail: text }),
    unknown,
  ]),
  artifactIds: Schema.Array(id),
  missingPrerequisites: Schema.Array(text),
});

export const manifestSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  title: text,
  application: Schema.Struct({
    name: text,
    location: recorded(text),
    repository: recorded(text),
  }),
  revisions: Schema.Struct({ base: revision, candidate: revision }),
  recipe: Schema.Struct({
    id: text,
    version: recorded(text),
    artifactId: id,
  }),
  capture: Schema.Struct({
    id: text,
    revision,
    producer: Schema.Struct({ name: text, version: recorded(text) }),
    startedAt: recorded(timestamp),
    finishedAt: recorded(timestamp),
    conditions: Schema.NonEmptyArray(text),
    execution: Schema.Literals(['complete', 'blocked', 'failed', 'unknown']),
    artifactIds: Schema.NonEmptyArray(id),
  }),
  artifacts: Schema.NonEmptyArray(artifact),
  checks: Schema.NonEmptyArray(check),
  missingPrerequisites: Schema.Array(text),
  limitations: Schema.NonEmptyArray(text),
}).check(
  Schema.makeFilter((manifest) => {
    const issues: Schema.FilterIssue[] = [];

    const artifactIds = new Set(manifest.artifacts.map((item) => item.id));

    const checkIds = new Set(manifest.checks.map((item) => item.id));

    if (artifactIds.size !== manifest.artifacts.length) {
      issues.push('Duplicate artifact IDs');
    }

    if (checkIds.size !== manifest.checks.length) {
      issues.push('Duplicate check IDs');
    }

    const references = [
      manifest.recipe.artifactId,
      ...manifest.capture.artifactIds,
      ...manifest.checks.flatMap((item) => item.artifactIds),
    ];

    for (const reference of references) {
      if (!artifactIds.has(reference)) {
        issues.push(`Undefined artifact ID: ${reference}`);
      }
    }

    const { startedAt, finishedAt } = manifest.capture;

    if (
      startedAt.kind === 'known' &&
      finishedAt.kind === 'known' &&
      DateTime.isLessThan(finishedAt.value, startedAt.value)
    ) {
      issues.push('Capture finishes before it starts');
    }

    return issues;
  }),
);

export type Manifest = typeof manifestSchema.Type;

export type Artifact = Manifest['artifacts'][number];

export type Check = Manifest['checks'][number];

export const parseManifest = Schema.decodeUnknownEffect(manifestSchema, {
  onExcessProperty: 'error',
});

export const parseManifestJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(manifestSchema),
  { onExcessProperty: 'error' },
);
