import { Schema } from 'effect';
import { recipeSchema } from './capture/recipe';
import { evidenceViewSchema } from './evidence-kinds';
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
  authority: Schema.Literals([
    'Executed by Observed',
    'Imported from Playwright',
  ]),
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
    actual: Schema.NullOr(Schema.Union([Schema.Finite, Schema.String])),
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

const uniqueCheckIds = Schema.makeFilter(
  (checks: readonly { id: string }[]) =>
    new Set(checks.map((item) => item.id)).size === checks.length,
  { message: 'Check IDs must be unique within a side' },
);

export const sideSchema = Schema.Union([
  Schema.Struct({
    execution: Schema.Literal('complete'),
    capture: capturedManifest,
    recipe: recipeSchema,
    observations: observationsSchema,
    evidence: Schema.Array(evidenceViewSchema),
    screenshot: text,
    checks: Schema.Array(check).check(uniqueCheckIds),
    ...sideEvidence,
  }),
  Schema.Struct({
    execution: Schema.Literal('capture-failed'),
    capture: capturedManifest,
    recipe: Schema.NullOr(recipeSchema),
    evidence: Schema.Array(evidenceViewSchema),
    screenshot: Schema.NullOr(text),
    checks: Schema.Array(unknownCheck).check(uniqueCheckIds),
    ...sideEvidence,
  }),
  Schema.Struct({
    execution: Schema.Literal('unavailable'),
    capture: Schema.NullOr(capturedManifest),
    recipe: Schema.NullOr(recipeSchema),
    screenshot: Schema.NullOr(text),
    checks: Schema.Array(unknownCheck).check(uniqueCheckIds),
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
      path: text.check(
        Schema.isPattern(/^(?:journey-[1-9][0-9]*\/)?visual-diff\.png$/),
      ),
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

// Ordered by precedence: the first kind any journey reaches decides the run.
export const conclusionKinds = [
  'regression',
  'check-failed',
  'unavailable',
  'no-regression',
  'not-checked',
  'preview',
] as const;

const conclusionSchema = Schema.Struct({
  kind: Schema.Literals(conclusionKinds),
  text,
});

// The quantity a check compares, formatted once so every adapter shows the
// same values. It never holds captured page text.
const measureSchema = Schema.Struct({
  label: text,
  base: Schema.NullOr(text),
  candidate: Schema.NullOr(text),
  limit: Schema.NullOr(text),
});

// One verdict per configured check, derived once from both sides so delivery
// renders it without recomputing.
const checkVerdictSchema = Schema.Struct({
  id: text,
  name: text,
  scope: text,
  expectation: text,
  verdict: Schema.Literals([
    'regression',
    'failed',
    'unknown',
    'passed',
    'not-run',
  ]),
  detail: text,
  measure: Schema.optionalKey(measureSchema),
});

const lineNumber = Schema.Int.check(Schema.isGreaterThan(0));

// A source line that evidence points at. `path` is relative to the captured
// project, as in its source snapshot; `side` names the snapshot the line
// number counts in. `diff` places the line in the base..candidate diff, and
// is unknown without a comparable base snapshot.
const anchorSchema = Schema.Struct({
  path: text,
  line: lineNumber,
  side: Schema.Literals(['base', 'candidate']),
  basis: Schema.Literals([
    'stack-frame',
    'component-source',
    'test-location',
    'diff-name-match',
  ]),
  evidence: text,
  artifacts: Schema.Array(text),
  diff: Schema.Literals([
    'added',
    'removed',
    'context',
    'unchanged',
    'unknown',
  ]),
});

// One observed problem or change, with the checks it bears on. A location is
// a fact about where evidence points, never a cause.
const findingSchema = Schema.Struct({
  id: text,
  evidence: text,
  checks: Schema.Array(text),
  subject: text,
  comparison: Schema.Literals(['new', 'persisting', 'changed', 'no-baseline']),
  location: Schema.Union([
    Schema.Struct({
      kind: Schema.Literal('anchored'),
      anchors: Schema.NonEmptyArray(anchorSchema),
    }),
    Schema.Struct({ kind: Schema.Literal('unanchored'), reason: text }),
  ]),
});

export type Anchor = typeof anchorSchema.Type;

export type Finding = typeof findingSchema.Type;

export const journeySchema = Schema.Struct({
  title: text,
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
  checks: Schema.Array(checkVerdictSchema),
  findings: Schema.Array(findingSchema),
  conclusion: conclusionSchema,
  limitations: Schema.Array(text),
});

const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const lineRangeSchema = Schema.Tuple([lineNumber, lineNumber]).check(
  Schema.makeFilter(([start, end]) => start <= end, {
    message: 'A line range must not end before it starts',
  }),
);

// Candidate line numbers of the changed lines, split by what coverage
// recorded. Changed lines with no generated code are in neither list.
const changedLinesSchema = Schema.Struct({
  ran: Schema.Array(lineRangeSchema),
  notRan: Schema.Array(lineRangeSchema),
});

const scopeFileIdentity = {
  path: text,
  change: Schema.Literals(['added', 'removed', 'modified']),
};

const anchorBasis = Schema.Literals([
  'stack-frame',
  'component-source',
  'test-location',
]);

// One file that differs between base and candidate. A relation comes only
// from recorded evidence; without any, the file is not observed.
const scopeFileSchema = Schema.Union([
  Schema.Struct({
    ...scopeFileIdentity,
    captured: Schema.Literal(true),
    relation: Schema.Literal('checked'),
    basis: anchorBasis,
    journeys: Schema.NonEmptyArray(text),
    checks: Schema.NonEmptyArray(text),
  }),
  Schema.Struct({
    ...scopeFileIdentity,
    captured: Schema.Literal(true),
    relation: Schema.Literal('exercised'),
    basis: Schema.Literal('coverage'),
    lines: changedLinesSchema,
    journeys: Schema.NonEmptyArray(text),
    checks: Schema.Array(text),
  }),
  Schema.Struct({
    ...scopeFileIdentity,
    captured: Schema.Literal(true),
    relation: Schema.Literal('exercised'),
    basis: Schema.Literals([...anchorBasis.literals, 'diff-name-match']),
    journeys: Schema.NonEmptyArray(text),
    checks: Schema.Array(text),
  }),
  Schema.Struct({
    ...scopeFileIdentity,
    captured: Schema.Literal(true),
    relation: Schema.Literal('not-observed'),
    basis: Schema.Literal('coverage'),
    lines: changedLinesSchema,
    reason: text,
    journeys: Schema.NonEmptyArray(text),
    checks: Schema.Array(text),
  }),
  Schema.Struct({
    ...scopeFileIdentity,
    captured: Schema.Literal(true),
    relation: Schema.Literal('not-observed'),
    basis: Schema.Literal('none'),
    reason: text,
    journeys: Schema.Array(text),
    checks: Schema.Array(text),
  }),
  Schema.Struct({
    ...scopeFileIdentity,
    captured: Schema.Literal(false),
    relation: Schema.Literal('outside-captured-source'),
    basis: Schema.Literal('none'),
    reason: text,
    journeys: Schema.Array(text),
    checks: Schema.Array(text),
  }),
]);

// One field that differs between the base and candidate definitions, with
// both values as they appear in observed.json.
const recipeFieldSchema = Schema.Struct({
  field: text,
  base: Schema.Json,
  candidate: Schema.Json,
});

const recipeSubject = {
  journey: text,
  // Absent when the difference is the journey itself.
  check: Schema.optionalKey(text),
};

const recipeDifferenceSchema = Schema.Union([
  Schema.Struct({
    ...recipeSubject,
    change: Schema.Literals(['added', 'removed']),
  }),
  Schema.Struct({
    ...recipeSubject,
    change: Schema.Literal('altered'),
    fields: Schema.NonEmptyArray(recipeFieldSchema),
  }),
]);

const recipeScopeSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('unchanged') }),
  Schema.Struct({ kind: Schema.Literal('unavailable'), reason: text }),
  Schema.Struct({
    kind: Schema.Literal('changed'),
    differences: Schema.NonEmptyArray(recipeDifferenceSchema),
  }),
]);

const reasonOr = <S extends Schema.Top>(listed: S) =>
  Schema.Union([
    listed,
    Schema.Struct({ kind: Schema.Literal('unavailable'), reason: text }),
  ]);

export const changeScopeSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('unavailable'), reason: text }),
  Schema.Struct({
    kind: Schema.Literal('recorded'),
    sources: Schema.Struct({ base: digest, candidate: digest }),
    files: Schema.Array(scopeFileSchema),
    // Git names changed files that neither snapshot contains.
    outside: reasonOr(Schema.Struct({ kind: Schema.Literal('listed') })),
    coverage: Schema.Array(
      Schema.Union([
        Schema.Struct({ journey: text, kind: Schema.Literal('recorded') }),
        Schema.Struct({
          journey: text,
          kind: Schema.Literal('unavailable'),
          reason: text,
        }),
      ]),
    ),
    recipe: recipeScopeSchema,
  }).check(
    Schema.makeFilter(
      (scope) =>
        new Set(scope.files.map((file) => file.path)).size ===
        scope.files.length,
      { message: 'Each changed file appears once' },
    ),
  ),
]);

export type ChangeScope = typeof changeScopeSchema.Type;

export type ScopeFile = typeof scopeFileSchema.Type;

export type ChangedLines = typeof changedLinesSchema.Type;

export type LineRange = typeof lineRangeSchema.Type;

export const resultSchemaVersion = 8;

export const comparisonSchema = Schema.Struct({
  schemaVersion: Schema.Literal(resultSchemaVersion),
  mode: Schema.Literals(['preview', 'comparison']),
  title: text,
  evaluatedAt: timestamp,
  journeys: Schema.NonEmptyArray(journeySchema),
  summary: Schema.Struct({ passed: count, total: count }),
  conclusion: conclusionSchema,
  changeScope: changeScopeSchema,
}).check(
  Schema.makeFilter(
    (result) =>
      result.summary.passed <= result.summary.total &&
      result.summary.total ===
        result.journeys.reduce((sum, item) => sum + item.checks.length, 0),
    { message: 'The check summary must match the journeys' },
  ),
);

export type Comparison = typeof comparisonSchema.Type;

export type Journey = typeof journeySchema.Type;

export type CheckVerdict = typeof checkVerdictSchema.Type;

export type Measure = typeof measureSchema.Type;

export type Conclusion = typeof conclusionSchema.Type;

export const conclusionExitCodes = {
  regression: 2,
  'check-failed': 2,
  unavailable: 1,
  'no-regression': 0,
  'not-checked': 0,
  preview: 0,
} satisfies Record<Conclusion['kind'], number>;

export type Side = typeof sideSchema.Type;

export type Check = Side['checks'][number];

export function everyCaptureFailed(
  journeys: Comparison['journeys'],
  mode: Comparison['mode'],
): boolean {
  return journeys.every(
    (journey) =>
      journey.candidate.execution === 'capture-failed' &&
      (mode === 'preview' || journey.base.execution === 'capture-failed'),
  );
}

export type UnknownCheck = typeof unknownCheck.Type;

export type SideArtifact = Side['artifacts'][number];

const journeySelectionSchema = Schema.Struct({
  directory: text.check(Schema.isPattern(/^journey-[1-9][0-9]*$/)),
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

export const selectionSchema = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  evaluatedAt: timestamp,
  mode: Schema.Literals(['preview', 'comparison']),
  journeys: Schema.NonEmptyArray(journeySelectionSchema),
}).check(
  Schema.makeFilter(
    (selection) =>
      new Set(selection.journeys.map((item) => item.directory)).size ===
      selection.journeys.length,
    { message: 'Journey directories must be unique' },
  ),
);

export type Selection = typeof selectionSchema.Type;

export type JourneySelection = typeof journeySelectionSchema.Type;
