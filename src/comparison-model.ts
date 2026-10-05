import { Option, Schema } from 'effect';
import { generatedOriginSchema, recipeSchema } from './capture/recipe';
import { journeySchema as projectJourneySchema } from './project';
import { evidenceViewSchema } from './evidence-kinds';
import {
  captureSchema,
  captureArtifactSchema,
  commitSchema,
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

const verdictKinds = [
  'regression',
  'failed',
  'unknown',
  'passed',
  'not-run',
] as const;

// The candidate's version of a check that observed.json alters. Its outcome
// sets no verdict.
const proposedSchema = Schema.Struct({
  expectation: text,
  outcome: Schema.Literals(['passed', 'failed', 'unknown', 'not-run']),
  detail: text,
  measure: Schema.optionalKey(measureSchema),
});

// How a difference between the base and candidate observed.json, or a changed
// imported test file, decided which definition judged the check.
const verdictRecipeSchema = Schema.Union([
  Schema.Struct({ change: Schema.Literal('added') }),
  Schema.Struct({ change: Schema.Literal('removed') }),
  Schema.Struct({
    change: Schema.Literal('altered'),
    proposed: proposedSchema,
  }),
  Schema.Struct({
    change: Schema.Literal('journey-altered'),
    fields: Schema.NonEmptyArray(text),
    proposed: Schema.optionalKey(proposedSchema),
  }),
  Schema.Struct({ change: Schema.Literal('test-file-changed') }),
]);

// One verdict per configured check, derived once from both sides so delivery
// renders it without recomputing.
const checkVerdictSchema = Schema.Struct({
  id: text,
  name: text,
  scope: text,
  expectation: text,
  verdict: Schema.Literals(verdictKinds),
  detail: text,
  measure: Schema.optionalKey(measureSchema),
  recipe: Schema.optionalKey(verdictRecipeSchema),
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
  generated: Schema.optionalKey(generatedOriginSchema),
  savingProposal: Schema.optionalKey(
    Schema.Struct({
      action: Schema.Literals(['save', 'replace']),
      files: Schema.NonEmptyArray(text),
    }),
  ),
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

const unavailableSchema = Schema.Struct({
  kind: Schema.Literal('unavailable'),
  reason: text,
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
// both values. A journey's defaults apply as they do in a capture, and an
// absent field is null.
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

// The base file that judged the checks, by commit and the SHA-256 of its
// UTF-8 text.
const recipeBase = Schema.Struct({
  kind: Schema.Literal('read'),
  commit: commitSchema,
  sha256: digest,
});

const recipeScopeSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('unchanged'), base: recipeBase }),
  unavailableSchema,
  Schema.Struct({
    kind: Schema.Literal('changed'),
    // An unusable base file makes every candidate check count as added.
    base: Schema.Union([
      recipeBase,
      Schema.Struct({
        kind: Schema.Literal('unusable'),
        commit: commitSchema,
        reason: text,
      }),
    ]),
    differences: Schema.NonEmptyArray(recipeDifferenceSchema),
  }),
]);

// The project's directory relative to the repository root, `.` at the root.
// Changed file paths are relative to the project, as source snapshots are;
// people read them joined to this directory.
const projectDirectory = text;

// Names Git reports as changed between the base and candidate revisions,
// relative to the project directory. Recorded at capture time, since the
// comparator reads only capture directories.
export const gitChangesSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('listed'),
    projectDirectory,
    files: Schema.Array(Schema.Struct(scopeFileIdentity)),
  }),
  unavailableSchema,
]);

export type GitChanges = typeof gitChangesSchema.Type;

export const changeScopeSchema = Schema.Union([
  unavailableSchema,
  Schema.Struct({
    kind: Schema.Literal('recorded'),
    sources: Schema.Struct({ base: digest, candidate: digest }),
    files: Schema.Array(scopeFileSchema),
    // Whether Git listed the changed files, including any that neither
    // snapshot contains.
    outside: Schema.Union([
      Schema.Struct({ kind: Schema.Literal('listed'), projectDirectory }),
      unavailableSchema,
    ]),
    coverage: Schema.Array(
      Schema.Union([
        Schema.Struct({ journey: text, kind: Schema.Literal('recorded') }),
        Schema.Struct({ journey: text, ...unavailableSchema.fields }),
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

export type RecipeScope = typeof recipeScopeSchema.Type;

// A record a map connection comes from: an artifact by its path in the
// report, or a journey's finding by its ID.
const mapEvidenceSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('artifact'), path: text }),
  Schema.Struct({ kind: Schema.Literal('finding'), journey: text, id: text }),
]);

const mapBlockSchema = Schema.Union([
  Schema.Struct({
    id: text,
    kind: Schema.Literal('file'),
    path: text,
    changed: Schema.Boolean,
    // Candidate line numbers the change added, null when the snapshots could
    // not be compared. Empty for an unchanged file or a removal.
    changedLines: Schema.NullOr(Schema.Array(lineRangeSchema)),
    imports: Schema.Union([
      Schema.Struct({
        kind: Schema.Literal('scanned'),
        // Specifiers that resolved to no file in the snapshot.
        unresolved: Schema.Array(text),
      }),
      unavailableSchema,
    ]),
  }),
  Schema.Struct({ id: text, kind: Schema.Literal('package'), name: text }),
  Schema.Struct({ id: text, kind: Schema.Literal('journey'), title: text }),
  Schema.Struct({
    id: text,
    kind: Schema.Literal('route'),
    method: text,
    path: text,
  }),
]);

const requestSide = Schema.Struct({
  count,
  statuses: Schema.Array(count),
});

const connectionIdentity = {
  from: text,
  to: text,
  evidence: Schema.NonEmptyArray(mapEvidenceSchema),
};

// Each connection type has one kind of source, and each connection lists the
// records it came from. `from` and `to` name blocks of the same map.
const mapConnectionSchema = Schema.Union([
  Schema.Struct({
    ...connectionIdentity,
    kind: Schema.Literal('imports'),
    change: Schema.Literals(['unchanged', 'added', 'removed']),
  }),
  Schema.Struct({
    ...connectionIdentity,
    kind: Schema.Literal('ran-in'),
    ran: Schema.Int.check(Schema.isGreaterThan(0)),
    notRan: count,
  }),
  Schema.Struct({
    ...connectionIdentity,
    kind: Schema.Literal('requested'),
    base: Schema.NullOr(requestSide),
    candidate: requestSide,
  }),
  Schema.Struct({
    ...connectionIdentity,
    kind: Schema.Literal('threw-at'),
    line: lineNumber,
    subject: text,
  }),
  Schema.Struct({
    ...connectionIdentity,
    kind: Schema.Literal('checked-by'),
    check: text,
    name: text,
  }),
]);

// The change scope's files with the files they import and the files that
// import them, and the journeys whose evidence touched them. The viewer lays
// it out and adds no block or connection.
export const changeMapSchema = Schema.Union([
  unavailableSchema,
  Schema.Struct({
    kind: Schema.Literal('recorded'),
    blocks: Schema.Array(mapBlockSchema),
    connections: Schema.Array(mapConnectionSchema),
  }).check(
    Schema.makeFilter(
      (map) => {
        const ids = new Set(map.blocks.map((block) => block.id));

        return (
          ids.size === map.blocks.length &&
          map.connections.every(
            (connection) => ids.has(connection.from) && ids.has(connection.to),
          )
        );
      },
      {
        message:
          'Block IDs are unique, and each connection joins two blocks of the map',
      },
    ),
  ),
]);

export type ChangeMap = typeof changeMapSchema.Type;

export type MapBlock = typeof mapBlockSchema.Type;

export type MapConnection = typeof mapConnectionSchema.Type;

export type MapEvidence = typeof mapEvidenceSchema.Type;

export const resultSchemaVersion = 9;

export const comparisonSchema = Schema.Struct({
  schemaVersion: Schema.Literal(resultSchemaVersion),
  mode: Schema.Literals(['preview', 'comparison']),
  title: text,
  evaluatedAt: timestamp,
  journeys: Schema.NonEmptyArray(journeySchema),
  summary: Schema.Struct({ passed: count, total: count }),
  conclusion: conclusionSchema,
  changeScope: changeScopeSchema,
  // Journeys only the base's observed.json defines. Nothing captured them, so
  // each of their checks is unknown.
  removedJourneys: Schema.Array(
    Schema.Struct({ journey: text, checks: Schema.Array(checkVerdictSchema) }),
  ),
  changeMap: changeMapSchema,
}).check(
  Schema.makeFilter(
    (result) =>
      result.summary.passed <= result.summary.total &&
      result.summary.total === runVerdicts(result).length,
    { message: 'The check summary must match the journeys' },
  ),
);

export type Comparison = typeof comparisonSchema.Type;

// Every check verdict of a run, including the checks of removed journeys.
export function runVerdicts(result: {
  journeys: readonly { checks: readonly CheckVerdict[] }[];
  removedJourneys: readonly { checks: readonly CheckVerdict[] }[];
}): CheckVerdict[] {
  return [
    ...result.journeys.flatMap((journey) => journey.checks),
    ...result.removedJourneys.flatMap((journey) => journey.checks),
  ];
}

const resultVersion = Schema.Struct({ schemaVersion: Schema.Int });

// Results are not upgraded; an older one needs new captures, as an older
// capture manifest does.
export function resultVersionProblem(input: unknown): string | null {
  const version = Schema.decodeUnknownOption(resultVersion)(input);

  if (
    Option.isNone(version) ||
    version.value.schemaVersion === resultSchemaVersion
  ) {
    return null;
  }

  const found = version.value.schemaVersion;

  return found < resultSchemaVersion
    ? `Result schema version ${found} is unsupported. This Observed reads version ${resultSchemaVersion}. Capture both revisions again.`
    : `Result schema version ${found} is unsupported. It was written by a newer Observed than this one, which reads version ${resultSchemaVersion}. Update Observed.`;
}

export type Journey = typeof journeySchema.Type;

export type CheckVerdict = typeof checkVerdictSchema.Type;

export type VerdictRecipe = typeof verdictRecipeSchema.Type;

export type Proposed = typeof proposedSchema.Type;

export function proposedOf(
  recipe: VerdictRecipe | undefined,
): Proposed | undefined {
  return recipe?.change === 'altered' || recipe?.change === 'journey-altered'
    ? recipe.proposed
    : undefined;
}

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

// The journeys of both observed.json files, as `observe` read them. The
// captures hold only the candidate's journeys, normalized.
export const recipeSourcesSchema = Schema.Struct({
  base: Schema.Union([
    Schema.Struct({
      ...recipeBase.fields,
      journeys: Schema.NonEmptyArray(projectJourneySchema),
    }),
    Schema.Struct({
      kind: Schema.Literal('unusable'),
      commit: commitSchema,
      reason: text,
    }),
    unavailableSchema,
  ]),
  candidate: Schema.NonEmptyArray(projectJourneySchema),
});

export type RecipeSources = typeof recipeSourcesSchema.Type;

export const selectionSchemaVersion = 3;

export const selectionSchema = Schema.Struct({
  schemaVersion: Schema.Literal(selectionSchemaVersion),
  evaluatedAt: timestamp,
  mode: Schema.Literals(['preview', 'comparison']),
  journeys: Schema.NonEmptyArray(journeySelectionSchema),
  changes: Schema.optionalKey(gitChangesSchema),
  recipes: Schema.optionalKey(recipeSourcesSchema),
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
