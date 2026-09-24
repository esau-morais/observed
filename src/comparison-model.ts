import { Schema } from 'effect';
import {
  captureSchema,
  digest,
  observationsSchema,
  text,
  timestamp,
} from './capture/model';

const artifact = Schema.Struct({
  id: text,
  path: Schema.NullOr(text),
  description: text,
  integrity: Schema.Literals(['verified', 'unavailable']),
  reason: Schema.NullOr(text),
});

const check = Schema.Struct({
  id: text,
  name: text,
  authority: Schema.Literal('Executed by Observed'),
  scope: text,
  expectation: text,
  outcome: Schema.Literals(['passed', 'failed', 'unknown']),
  actual: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  detail: text,
});

export const sideSchema = Schema.Struct({
  manifest: Schema.NullOr(captureSchema),
  manifestHash: Schema.NullOr(digest),
  execution: Schema.Literals(['complete', 'capture-failed', 'unavailable']),
  check,
  observations: Schema.NullOr(observationsSchema),
  artifacts: Schema.Array(artifact),
  screenshot: Schema.NullOr(text),
  unresolved: Schema.Array(text),
});

export const comparisonSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  title: text,
  evaluatedAt: timestamp,
  base: sideSchema,
  candidate: sideSchema,
  comparison: Schema.Union([
    Schema.Struct({
      kind: Schema.Literal('available'),
      basis: text,
      requestDifference: Schema.Int,
      visual: Schema.Literals(['unchanged', 'changed']),
    }),
    Schema.Struct({
      kind: Schema.Literal('unavailable'),
      reasons: Schema.NonEmptyArray(text),
    }),
  ]),
  conclusion: Schema.Struct({
    kind: Schema.Literals(['regression', 'no-regression', 'unavailable']),
    text,
  }),
  limitations: Schema.Array(text),
});

export type Comparison = typeof comparisonSchema.Type;

export type Side = typeof sideSchema.Type;

export const selectionSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  evaluatedAt: timestamp,
  baseIssue: Schema.optionalKey(text),
  candidateIssue: Schema.optionalKey(text),
  base: Schema.NullOr(
    Schema.Struct({ manifestHash: digest, sourceHash: digest }),
  ),
  candidate: Schema.NullOr(
    Schema.Struct({ manifestHash: digest, sourceHash: digest }),
  ),
});

export type Selection = typeof selectionSchema.Type;
