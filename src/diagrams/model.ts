import { Schema } from 'effect';
import { commitSchema, digest } from '../capture/model';

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
