import { Schema } from 'effect';
import { recipeSchema } from './capture/recipe';
import {
  captureSchema,
  captureArtifactSchema,
  digest,
  observationsSchema,
  text,
  timestamp,
} from './capture/model';

const artifact = Schema.Union([
  Schema.Struct({
    id: text,
    description: text,
    integrity: Schema.Literal('verified'),
    path: text,
  }),
  Schema.Struct({
    id: text,
    description: text,
    integrity: Schema.Literal('unavailable'),
    reason: text,
  }),
]);

const checkIdentity = {
  id: text,
  name: text,
  authority: Schema.Literal('Executed by Observed'),
  scope: text,
  expectation: text,
  detail: text,
};

const unknownCheck = Schema.Struct({
  ...checkIdentity,
  outcome: Schema.Literal('unknown'),
  actual: Schema.Null,
});

const check = Schema.Union([
  Schema.Struct({
    ...checkIdentity,
    outcome: Schema.Literals(['passed', 'failed']),
    actual: Schema.NullOr(
      Schema.Union([
        Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
        Schema.String,
      ]),
    ),
  }),
  Schema.Struct({
    ...checkIdentity,
    outcome: Schema.Literal('not-run'),
    actual: Schema.Null,
  }),
  unknownCheck,
]);

const capturedManifest = Schema.Struct({
  manifest: captureSchema,
  sha256: digest,
});

const sideEvidence = {
  artifacts: Schema.Array(artifact),
  unresolved: Schema.Array(text),
};

export const sideSchema = Schema.Union([
  Schema.Struct({
    execution: Schema.Literal('complete'),
    capture: capturedManifest,
    recipe: recipeSchema,
    observations: observationsSchema,
    screenshot: text,
    check,
    ...sideEvidence,
  }),
  Schema.Struct({
    execution: Schema.Literal('capture-failed'),
    capture: capturedManifest,
    recipe: Schema.NullOr(recipeSchema),
    screenshot: Schema.NullOr(text),
    check: unknownCheck,
    ...sideEvidence,
  }),
  Schema.Struct({
    execution: Schema.Literal('unavailable'),
    capture: Schema.NullOr(capturedManifest),
    recipe: Schema.NullOr(recipeSchema),
    screenshot: Schema.NullOr(text),
    check: unknownCheck,
    ...sideEvidence,
  }),
]);

export const comparisonSchema = Schema.Struct({
  schemaVersion: Schema.Literal(3),
  mode: Schema.Literals(['preview', 'comparison']),
  title: text,
  evaluatedAt: timestamp,
  base: sideSchema,
  candidate: sideSchema,
  comparison: Schema.Union([
    Schema.Struct({ kind: Schema.Literal('preview') }),
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
    kind: Schema.Literals([
      'regression',
      'no-regression',
      'unavailable',
      'not-checked',
      'preview',
      'check-failed',
    ]),
    text,
  }),
  limitations: Schema.Array(text),
});

export type Comparison = typeof comparisonSchema.Type;

export type Side = typeof sideSchema.Type;

export type Check = Side['check'];

export type UnknownCheck = typeof unknownCheck.Type;

export type SideArtifact = Side['artifacts'][number];

export const selectionSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  evaluatedAt: timestamp,
  mode: Schema.optionalKey(Schema.Literals(['preview', 'comparison'])),
  baseIssue: Schema.optionalKey(text),
  candidateIssue: Schema.optionalKey(text),
  baseFailureArtifacts: Schema.optionalKey(Schema.Array(captureArtifactSchema)),
  candidateFailureArtifacts: Schema.optionalKey(
    Schema.Array(captureArtifactSchema),
  ),
  base: Schema.NullOr(
    Schema.Struct({ manifestHash: digest, sourceHash: digest }),
  ),
  candidate: Schema.NullOr(
    Schema.Struct({ manifestHash: digest, sourceHash: digest }),
  ),
});

export type Selection = typeof selectionSchema.Type;
