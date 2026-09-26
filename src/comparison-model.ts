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

const pixels = Schema.Int.check(Schema.isGreaterThan(0));

const imageSize = { width: pixels, height: pixels };

const box = {
  x: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  y: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  ...imageSize,
};

const visualRegion = Schema.Struct({ ...box, changedPixels: pixels });

const threshold = Schema.Number.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(1),
);

type Box = { x: number; y: number; width: number; height: number };

function inside(image: { width: number; height: number }, area: Box): boolean {
  return (
    area.x + area.width <= image.width && area.y + area.height <= image.height
  );
}

export const maxVisualRegions = 10;

export const visualSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('identical'), ...imageSize }),
  Schema.Struct({
    kind: Schema.Literal('below-threshold'),
    ...imageSize,
    threshold,
    differingPixels: pixels,
    bounds: Schema.Struct(box),
  }).check(
    Schema.makeFilter(
      (visual) =>
        visual.differingPixels <= visual.width * visual.height &&
        inside(visual, visual.bounds),
      { message: 'Differing pixels must lie inside the screenshot' },
    ),
  ),
  Schema.Struct({
    kind: Schema.Literal('changed'),
    ...imageSize,
    threshold,
    differingPixels: pixels,
    changedPixels: pixels,
    regionCount: pixels,
    regions: Schema.NonEmptyArray(visualRegion),
    diff: Schema.Struct({
      path: Schema.Literal('visual-diff.png'),
      sha256: digest,
    }),
  }).check(
    Schema.makeFilter(
      (visual) =>
        visual.changedPixels <= visual.differingPixels &&
        visual.differingPixels <= visual.width * visual.height &&
        visual.regions.length <=
          Math.min(visual.regionCount, maxVisualRegions) &&
        visual.regions.every((area) => inside(visual, area)),
      {
        message:
          'Changed pixel counts and regions must be consistent with the screenshot',
      },
    ),
  ),
  Schema.Struct({
    kind: Schema.Literal('size-differs'),
    base: Schema.Struct(imageSize),
    candidate: Schema.Struct(imageSize),
  }),
  Schema.Struct({ kind: Schema.Literal('unavailable'), reason: text }),
]);

export type Visual = typeof visualSchema.Type;

export type VisualRegion = typeof visualRegion.Type;

export const comparisonSchema = Schema.Struct({
  schemaVersion: Schema.Literal(5),
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
      visual: visualSchema,
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
