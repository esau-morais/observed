import { Schema } from 'effect';
import { commitSchema, digest } from '../capture/model';
import { comparisonSchema, type Comparison } from '../comparison-model';
import { json, sha256 } from '../encoding';

export function diagramResultHash(result: Comparison): string {
  return sha256(json(Schema.decodeUnknownSync(comparisonSchema)(result)));
}

export function diagramRevisions(result: Comparison) {
  const commits = { base: '', candidate: '' };
  for (const side of ['base', 'candidate'] as const) {
    for (const journey of result.journeys) {
      const revision = journey[side].capture?.manifest.source.revision;
      if (revision?.kind === 'worktree') {
        return {
          kind: 'not-run',
          reason:
            'Diagram observations need a base and candidate commit; this capture is a worktree.',
        } as const;
      }

      if (revision?.kind !== 'commit') {
        return {
          kind: 'unavailable',
          reason: 'The captured diagram revision is unavailable.',
        } as const;
      }

      if (commits[side] !== '' && commits[side] !== revision.commit) {
        return {
          kind: 'unavailable',
          reason: 'The journeys captured different commits.',
        } as const;
      }

      commits[side] = revision.commit;
    }
  }

  if (commits.base === '' || commits.candidate === '') {
    return {
      kind: 'unavailable',
      reason: 'The captured diagram revision is unavailable.',
    } as const;
  }

  return {
    kind: 'commits',
    baseCommit: commits.base,
    candidateCommit: commits.candidate,
  } as const;
}

export const diagramEnvironmentSchema = Schema.Struct({
  browser: Schema.NonEmptyString,
  platform: Schema.NonEmptyString,
  locale: Schema.NonEmptyString,
  timezone: Schema.NonEmptyString,
  viewport: Schema.Struct({
    width: Schema.Int.check(Schema.isGreaterThan(0)),
    height: Schema.Int.check(Schema.isGreaterThan(0)),
    scale: Schema.Number.check(Schema.isGreaterThan(0)),
  }),
  fontFamily: Schema.NonEmptyString,
});

export const diagramConditionsSchema = Schema.Struct({
  environment: diagramEnvironmentSchema,
  browserArguments: Schema.Array(Schema.String),
  rendererHash: digest,
  configurationHash: digest,
  theme: Schema.NonEmptyString,
});

const artifact = (extension: 'svg' | 'png') =>
  Schema.Struct({
    path: Schema.String.check(
      Schema.isPattern(
        new RegExp(`^diagrams/\\d+-(base|candidate)\\.${extension}$`),
      ),
    ),
    sha256: digest,
  });

export const diagramSideSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('absent') }),
  Schema.Struct({
    kind: Schema.Literal('unavailable'),
    reason: Schema.NonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal('rendered'),
    svg: artifact('svg'),
    png: artifact('png'),
  }),
]);

export const diagramManifestSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  resultHash: digest,
  observation: Schema.Union([
    Schema.Struct({
      kind: Schema.Literals(['unavailable', 'not-run']),
      reason: Schema.NonEmptyString,
    }),
    Schema.Struct({
      kind: Schema.Literal('complete'),
      baseCommit: commitSchema,
      candidateCommit: commitSchema,
      producer: Schema.Struct({
        name: Schema.Literal('mermaid'),
        version: Schema.NonEmptyString,
      }),
      conditions: Schema.NullOr(diagramConditionsSchema),
      pairs: Schema.Array(
        Schema.Struct({
          file: Schema.NonEmptyString,
          heading: Schema.String,
          order: Schema.Int.check(Schema.isGreaterThan(0)),
          change: Schema.Literals(['changed', 'added', 'removed']),
          base: diagramSideSchema,
          candidate: diagramSideSchema,
        }),
      ),
    }),
  ]),
});

export type DiagramSide = typeof diagramSideSchema.Type;
export type DiagramManifest = typeof diagramManifestSchema.Type;
