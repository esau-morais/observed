import { proposeSaving } from './generated-proposals';
import { DateTime, Effect, Option, Schema } from 'effect';
import { readFile, realpath } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import {
  parseCapture,
  parseObservations,
  timestamp,
  type Capture,
  type CaptureArtifact,
  type Observations,
} from './capture/model';
import { parseRecipe, type Recipe } from './capture/recipe';
import { checkKinds, type CheckDefinition, type CheckKinds } from './checks';
import {
  importedAuthority,
  playwrightPairs,
  unknownPlaywrightChecks,
  unknownRun,
} from './checks/playwright';
import type {
  CheckIdentity,
  CheckInput,
  CheckKind,
  Evaluation,
} from './checks/define';
import {
  evidenceKinds,
  evidenceViewSchema,
  isEvidenceKind,
  type EvidenceKind,
  type EvidenceView,
} from './evidence-kinds';
import { json, sha256 } from './encoding';
import path from 'node:path';
import { changeMap, repositoryMap } from './change-map';
import { DescriptionFailure, descriptionProblem } from './agent-descriptions';
import {
  changeScope,
  coverageSchemaVersion,
  parseCoverage,
  type CoverageRecord,
  type ScopeJourney,
} from './change-scope';
import type {
  ChangeScope,
  Check,
  CheckVerdict,
  Comparison,
  Conclusion,
  GitChanges,
  Journey,
  JourneySelection,
  Measure,
  Proposed,
  Selection,
  Side,
  SideArtifact,
  UnknownCheck,
  VerdictRecipe,
  Visual,
} from './comparison-model';
import {
  conclusionKinds,
  everyCaptureFailed,
  proposedOf,
  resultSchemaVersion,
  runVerdicts,
} from './comparison-model';
import {
  recipePlan,
  sameDefinition,
  type JourneyJudgement,
  type RecipePlan,
} from './recipe-diff';
import {
  inspectArtifact,
  readVerifiedArtifact,
  type ArtifactResult,
} from './evidence';
import { nodeIo } from './node-io';
import { decodePng, type DecodedPng } from './png';
import { relativePathSchema } from './project';
import {
  journeyFindings,
  type ScriptMap,
  type SideSource,
} from './source-anchors';
import {
  parseSourceMap,
  sourceMapIndexPath,
  sourceMapIndexSchema,
} from './source-map';
import { comparePixels } from './visual';

const requiredArtifacts = [
  'recipe',
  'requests',
  'errors',
  'transcript',
  'screenshot',
  'observations',
] as const;

type Expected = {
  manifestHash: string;
  sourceHash: string;
};

type InspectSideOptions = {
  directory: string | null;
  prefix: string;
  evaluatedAt: string;
  expected?: Expected;
};

function expectationFor<K extends CheckDefinition['kind']>(
  definition: Extract<CheckDefinition, { kind: K }>,
): string {
  const kind: CheckKinds[K] = checkKinds[definition.kind];

  return kind.expectation(definition);
}

function unknownChecks(
  detail: string,
  recipe: Recipe | null = null,
): UnknownCheck[] {
  if (recipe === null) {
    return [
      {
        id: 'capture-evidence',
        name: 'Capture evidence',
        authority: 'Executed by Observed',
        scope: 'The configured page and recorded capture window.',
        expectation: 'No named expectation available.',
        outcome: 'unknown',
        actual: null,
        detail,
      },
    ];
  }

  return [
    ...recipe.checks.map((definition): UnknownCheck => ({
      id: definition.id,
      name: definition.name,
      authority: 'Executed by Observed',
      scope: definition.scope,
      expectation: expectationFor(definition),
      outcome: 'unknown',
      actual: null,
      detail,
    })),
    ...unknownPlaywrightChecks(recipe, detail),
  ];
}

function sideDetail(side: Side): string {
  const unknown = side.checks.find((check) => check.outcome === 'unknown');

  return unknown?.detail ?? side.unresolved.join('; ');
}

type CompleteSide = Extract<Side, { execution: 'complete' }>;

// Declared evidence for one check on one side, or why it is missing.
function checkInput(
  side: CompleteSide,
  kinds: readonly EvidenceKind[],
):
  | { kind: 'ready'; input: CheckInput<EvidenceKind> }
  | { kind: 'missing'; detail: string } {
  const evidence: Partial<Record<EvidenceKind, unknown>> = {};

  for (const kind of kinds) {
    const view = side.evidence.find((item) => item.kind === kind);

    if (view === undefined || view.status === 'unavailable') {
      return {
        kind: 'missing',
        detail: `${evidenceKinds[kind].title} evidence unavailable: ${view?.reason ?? 'not recorded'}`,
      };
    }

    evidence[kind] = view.value;
  }

  return {
    kind: 'ready',
    input: {
      observations: side.observations,
      // The loop above recorded every declared kind, and an evaluator's type
      // lets it read only the kinds it declared.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      evidence: evidence as CheckInput<EvidenceKind>['evidence'],
    },
  };
}

function checkResult(
  definition: CheckIdentity,
  expectation: string,
  evaluation: Evaluation,
): Check {
  const identity = {
    id: definition.id,
    name: definition.name,
    authority: 'Executed by Observed',
    scope: definition.scope,
    expectation,
    detail: evaluation.detail,
  } as const;

  return evaluation.outcome === 'passed' || evaluation.outcome === 'failed'
    ? { ...identity, outcome: evaluation.outcome, actual: evaluation.actual }
    : { ...identity, outcome: evaluation.outcome, actual: null };
}

export type CheckPair = {
  base: Check | null;
  candidate: Check;
  // Set when a comparable, known pair establishes a regression.
  regression: string | null;
  measure?: Measure;
  recipe?: VerdictRecipe;
};

const unknownEvaluation = (detail: string): Evaluation => ({
  outcome: 'unknown',
  actual: null,
  detail,
});

function reading(evaluation: Evaluation | null): string | null {
  if (
    evaluation === null ||
    (evaluation.outcome !== 'passed' && evaluation.outcome !== 'failed')
  ) {
    return null;
  }

  return (
    evaluation.reading ??
    (typeof evaluation.actual === 'number' ? String(evaluation.actual) : null)
  );
}

function describeActual(check: Check | undefined): string {
  return check === undefined || check.actual === null
    ? 'unknown'
    : String(check.actual);
}

// Evaluates one configured check on both sides through its kind. Missing
// declared evidence makes that side unknown before the kind sees it, and a
// kind that compares the sides gets no verdict from an unusable base.
export function evaluateCheck<D extends CheckIdentity>(
  kind: CheckKind<D, EvidenceKind>,
  definition: D,
  {
    base,
    candidate,
    mode,
    comparable,
  }: {
    base: CompleteSide | null;
    candidate: CompleteSide;
    mode: 'preview' | 'comparison';
    comparable: boolean;
  },
): CheckPair {
  const expectation = kind.expectation(definition);
  const baseInput = base === null ? null : checkInput(base, kind.evidence);
  const candidateInput = checkInput(candidate, kind.evidence);
  const readBase = baseInput?.kind === 'ready' ? baseInput.input : null;
  const comparesSides =
    typeof kind.needsBase === 'function'
      ? kind.needsBase(definition)
      : kind.needsBase === true || kind.regression !== undefined;
  let blocked: string | null = null;

  if (mode === 'comparison' && comparesSides) {
    if (baseInput === null) {
      blocked = 'Base: capture unavailable';
    } else if (baseInput.kind === 'missing') {
      blocked = `Base: ${baseInput.detail}`;
    } else if (!comparable) {
      blocked = 'Base: not comparable with the candidate';
    }
  }

  let candidateEvaluation: Evaluation;
  let baseEvaluation: Evaluation | null = null;

  if (candidateInput.kind === 'missing') {
    candidateEvaluation = unknownEvaluation(candidateInput.detail);
  } else if (blocked !== null) {
    candidateEvaluation = unknownEvaluation(blocked);
  } else {
    const evaluated = kind.evaluate({
      definition,
      base: readBase,
      candidate: candidateInput.input,
      comparable,
    });
    candidateEvaluation = evaluated.candidate;
    baseEvaluation = evaluated.base;
  }

  if (baseInput?.kind === 'missing') {
    baseEvaluation = unknownEvaluation(baseInput.detail);
  } else if (readBase !== null && baseEvaluation === null) {
    baseEvaluation = kind.evaluate({
      definition,
      base: null,
      candidate: readBase,
      comparable: false,
    }).candidate;
  }

  const before =
    baseEvaluation === null
      ? null
      : checkResult(definition, expectation, baseEvaluation);
  const after = checkResult(definition, expectation, candidateEvaluation);
  let regression: string | null = null;

  if (
    mode === 'comparison' &&
    comparable &&
    before !== null &&
    readBase !== null &&
    candidateInput.kind === 'ready' &&
    (before.outcome === 'passed' || before.outcome === 'failed') &&
    (after.outcome === 'passed' || after.outcome === 'failed')
  ) {
    if (kind.regression !== undefined && baseEvaluation !== null) {
      regression =
        kind.regression({
          definition,
          base: { ...readBase, evaluation: baseEvaluation },
          candidate: {
            ...candidateInput.input,
            evaluation: candidateEvaluation,
          },
        })?.detail ?? null;
    } else if (before.outcome === 'passed' && after.outcome === 'failed') {
      regression = `${after.name} passed on base and failed on candidate. Base: ${describeActual(before)}; candidate: ${describeActual(after)}. ${expectation}`;
    }
  }

  const measured = kind.measure?.(definition);

  return {
    base: before,
    candidate: after,
    regression,
    ...(measured === undefined
      ? {}
      : {
          measure: {
            label: measured.label,
            base: reading(baseEvaluation),
            candidate: reading(candidateEvaluation),
            limit: measured.limit,
          },
        }),
  };
}

function evaluateDefinition<K extends CheckDefinition['kind']>(
  definition: Extract<CheckDefinition, { kind: K }>,
  sides: Parameters<typeof evaluateCheck>[2],
): CheckPair {
  const kind: CheckKinds[K] = checkKinds[definition.kind];

  return evaluateCheck(kind, definition, sides);
}

function proposed({ candidate, measure }: CheckPair): Proposed {
  return {
    expectation: candidate.expectation,
    outcome: candidate.outcome,
    detail: candidate.detail,
    ...(measure === undefined ? {} : { measure }),
  };
}

function unknownPair(
  definition: CheckDefinition,
  detail: string,
  recipe?: VerdictRecipe,
): CheckPair {
  const check = checkResult(
    definition,
    expectationFor(definition),
    unknownEvaluation(detail),
  );

  return {
    base: check,
    candidate: check,
    regression: null,
    ...(recipe === undefined ? {} : { recipe }),
  };
}

function listed(values: readonly string[]): string {
  return values.length <= 1
    ? values.join('')
    : `${values.slice(0, -1).join(', ')} and ${values.at(-1) ?? ''}`;
}

// The base's definition of a check judges both captures. A check only the
// candidate defines has no baseline, and a journey whose fields changed
// leaves every check unknown, since its captures follow the candidate's
// journey.
function executedPairs(
  sides: Parameters<typeof evaluateCheck>[2],
  judgement: JourneyJudgement,
): CheckPair[] {
  const evaluate = (definition: CheckDefinition) =>
    evaluateDefinition(definition, sides);
  const captured = sides.candidate.recipe.checks;
  const added = (definition: CheckDefinition): CheckPair => ({
    ...evaluate(definition),
    base: null,
    regression: null,
    recipe: { change: 'added' },
  });

  if (judgement.kind === 'not-compared') {
    return captured.map(evaluate);
  }

  if (judgement.kind === 'added') {
    return captured.map(added);
  }

  if (judgement.kind === 'unreadable') {
    return captured.map((definition) =>
      unknownPair(
        definition,
        `The base revision's observed.json could not be read, so no check can be judged. ${judgement.reason}`,
      ),
    );
  }

  const baseOnly = judgement.base.filter(
    (definition) => !captured.some((item) => item.id === definition.id),
  );
  const [field, ...fields] = judgement.fields;

  if (field !== undefined) {
    const detail = `This change alters the journey's ${listed([field, ...fields])}, so the captures cannot apply the base's checks.`;

    return [
      ...captured.map((definition) =>
        unknownPair(
          judgement.base.find((item) => item.id === definition.id) ??
            definition,
          detail,
          {
            change: 'journey-altered',
            fields: [field, ...fields],
            proposed: proposed(evaluate(definition)),
          },
        ),
      ),
      ...baseOnly.map((definition) =>
        unknownPair(definition, detail, {
          change: 'journey-altered',
          fields: [field, ...fields],
        }),
      ),
    ];
  }

  return [
    ...captured.map((definition): CheckPair => {
      const previous = judgement.base.find((item) => item.id === definition.id);

      if (previous === undefined) {
        return added(definition);
      }

      return sameDefinition(previous, definition)
        ? evaluate(definition)
        : {
            ...evaluate(previous),
            recipe: {
              change: 'altered',
              proposed: proposed(evaluate(definition)),
            },
          };
    }),
    ...baseOnly.map((definition): CheckPair => ({
      ...evaluate(definition),
      recipe: { change: 'removed' },
    })),
  ];
}

// Imported tests follow the journey's judgement. Their definitions live in
// the app's test files: a new journey gives them no baseline, and a changed
// journey or an unread base file leaves them unknown.
function judgedImports(
  pairs: readonly CheckPair[],
  judgement: JourneyJudgement,
): CheckPair[] {
  const unknown = (pair: CheckPair, detail: string): CheckPair => {
    const check: Check = {
      ...pair.candidate,
      outcome: 'unknown',
      actual: null,
      detail,
    };

    return {
      base: pair.base === null ? null : check,
      candidate: check,
      regression: null,
    };
  };

  switch (judgement.kind) {
    case 'not-compared':
      return [...pairs];
    case 'added':
      return pairs.map((pair) => ({
        ...pair,
        base: null,
        regression: null,
        recipe: { change: 'added' },
      }));
    case 'unreadable':
      return pairs.map((pair) =>
        unknown(
          pair,
          `The base revision's observed.json could not be read, so no check can be judged. ${judgement.reason}`,
        ),
      );
    case 'compared': {
      const [field, ...fields] = judgement.fields;

      return field === undefined
        ? [...pairs]
        : pairs.map((pair) => ({
            ...unknown(
              pair,
              `This change alters the journey's ${listed([field, ...fields])}, so the captures cannot apply the base's checks.`,
            ),
            recipe: {
              change: 'journey-altered',
              fields: [field, ...fields],
              proposed: proposed(pair),
            },
          }));
    }
    default:
      return judgement satisfies never;
  }
}

function evaluatePairs(
  base: CompleteSide | null,
  candidate: CompleteSide,
  mode: 'preview' | 'comparison',
  comparable: boolean,
  judgement: JourneyJudgement = { kind: 'not-compared' },
): { executed: CheckPair[]; imported: CheckPair[] } {
  const sides = { base, candidate, mode, comparable };
  const judged: JourneyJudgement =
    mode === 'preview' ? { kind: 'not-compared' } : judgement;

  return {
    executed: executedPairs(sides, judged),
    imported: judgedImports(playwrightPairs(sides), judged),
  };
}

function comparableConditions(capture: Capture) {
  if (capture.conditions.kind === 'unavailable') {
    return capture.conditions;
  }

  return { ...capture.conditions.value, dependenciesHash: null };
}

function unavailable(reason: string): Side {
  return {
    execution: 'unavailable',
    capture: null,
    recipe: null,
    screenshot: null,
    checks: unknownChecks(reason),
    artifacts: [],
    unresolved: [reason],
  };
}

const isEvidenceView = Schema.is(evidenceViewSchema);

const parseEvidenceFile = Effect.fnUntraced(function* (
  kind: EvidenceKind,
  input: string,
) {
  const definition = evidenceKinds[kind];
  const malformed: EvidenceView = {
    kind,
    status: 'unavailable',
    reason: `Evidence file is malformed or not schema version ${definition.schemaVersion}`,
  };
  const file = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(definition.file),
    { onExcessProperty: 'error' },
  )(input).pipe(
    Effect.map((decoded) => decoded.value),
    Effect.catchTag('SchemaError', () => Effect.succeed(undefined)),
  );
  const view = { kind, status: 'recorded', value: file };

  return file !== undefined && isEvidenceView(view) ? view : malformed;
});

const evidenceViews = Effect.fnUntraced(function* (
  capture: Capture,
  recipe: Recipe,
  byPath: ReadonlyMap<string, ArtifactResult>,
) {
  const views: EvidenceView[] = [];

  for (const entry of capture.evidence) {
    if (!isEvidenceKind(entry.kind)) {
      views.push({
        kind: entry.kind,
        status: 'unavailable',
        reason: 'This Observed does not support this evidence kind',
      });
    } else if (entry.status === 'unavailable') {
      views.push({
        kind: entry.kind,
        status: 'unavailable',
        reason: entry.reason,
      });
    } else if (
      entry.schemaVersion !== evidenceKinds[entry.kind].schemaVersion
    ) {
      views.push({
        kind: entry.kind,
        status: 'unavailable',
        reason: `Evidence schema version ${entry.schemaVersion} is unsupported`,
      });
    } else {
      const artifact = byPath.get(entry.path);
      const read =
        artifact?.kind === 'available' && artifact.hash === entry.sha256
          ? yield* readVerifiedText(artifact)
          : ({
              kind: 'unavailable',
              reason: 'Evidence artifact is missing or changed',
            } as const);

      views.push(
        read.kind === 'available'
          ? yield* parseEvidenceFile(entry.kind, read.text)
          : { kind: entry.kind, status: 'unavailable', reason: read.reason },
      );
    }
  }

  for (const collector of recipe.collectors) {
    if (!views.some((view) => view.kind === collector.kind)) {
      views.push({
        kind: collector.kind,
        status: 'unavailable',
        reason: 'The capture recorded no evidence of this kind',
      });
    }
  }

  return views;
});

const isRelativePath = Schema.is(relativePathSchema);
const safeRelativePath = (value: string): boolean => isRelativePath(value);

function artifactLink(prefix: string, artifactPath: string): string {
  return [...prefix.split('/'), ...artifactPath.split('/')]
    .map(encodeURIComponent)
    .join('/');
}

function describeArtifact(item: ArtifactResult, prefix: string): SideArtifact {
  const { id, description } = item.artifact;

  return item.kind === 'available'
    ? {
        id,
        description,
        integrity: 'verified',
        path: artifactLink(prefix, item.artifact.path),
      }
    : { id, description, integrity: 'unavailable', reason: item.reason };
}

const inspectFailureSide = Effect.fnUntraced(function* (
  directory: string | null,
  prefix: string,
  reason: string,
  artifacts: readonly CaptureArtifact[] = [],
) {
  const side = unavailable(reason);
  if (directory === null) {
    return side;
  }

  const inspected = yield* Effect.forEach(artifacts, (artifact) =>
    inspectArtifact(directory, artifact),
  );

  return {
    ...side,
    artifacts: inspected.map((item) => describeArtifact(item, prefix)),
    unresolved: [
      reason,
      ...inspected.flatMap((item) =>
        item.kind === 'unavailable'
          ? [`${item.artifact.id}: ${item.reason}`]
          : [],
      ),
    ],
  } satisfies Side;
});

function captureProblems(
  capture: Capture,
  evaluatedAt: string,
  recipe: Recipe | null,
): string[] {
  const reasons: string[] = [];

  if (capture.execution.kind === 'failed') {
    reasons.push(
      `Capture failed (${capture.execution.category}): ${capture.execution.reason}`,
    );
  } else if (capture.conditions.kind === 'unavailable') {
    reasons.push(
      `Capture conditions unavailable: ${capture.conditions.reason}`,
    );
  }

  const age =
    DateTime.toEpochMillis(DateTime.makeUnsafe(evaluatedAt)) -
    DateTime.toEpochMillis(DateTime.makeUnsafe(capture.finishedAt));

  if (age < 0) {
    reasons.push('Capture timestamp is in the future relative to evaluatedAt');
  } else if (recipe !== null && age > recipe.maxAgeMs) {
    reasons.push(`Capture is stale: older than ${recipe.maxAgeMs} ms`);
  }

  const files = capture.source.files
    .map((file) => ({
      path: file.path,
      sha256: file.sha256,
      ...(file.executable === undefined ? {} : { executable: file.executable }),
    }))
    .sort((left, right) => {
      if (left.path < right.path) {
        return -1;
      }

      return Number(left.path > right.path);
    });

  const sourceHash = sha256(json({ entry: capture.source.entry, files }));

  if (sourceHash !== capture.source.sha256) {
    reasons.push(
      'Source snapshot SHA-256 does not match its entry and sorted files',
    );
  }

  if (!files.some((file) => file.path === capture.source.entry)) {
    reasons.push('Source entry is missing from source.files');
  }

  return reasons;
}

function observationProblems(
  capture: Capture,
  observations: Observations,
  recipe: Recipe | null,
): string[] {
  const { startedAt, finishedAt } = observations.window;

  if (
    observations.requests.some(
      (request) =>
        request.origin !== 'application' &&
        recipe?.allowedOrigins?.includes(request.origin) !== true,
    )
  ) {
    return ['Observed request origin is outside the protected recipe'];
  }

  if (
    startedAt > finishedAt ||
    startedAt < capture.startedAt ||
    finishedAt > capture.finishedAt
  ) {
    return ['Observation window is inverted or outside the capture interval'];
  }

  if (
    observations.requests.some(
      (request) =>
        request.startedAt < startedAt || request.startedAt > finishedAt,
    )
  ) {
    return ['A request timestamp is outside the observation window'];
  }

  return [];
}

const readVerifiedText = Effect.fnUntraced(function* (
  artifact: Extract<ArtifactResult, { kind: 'available' }>,
) {
  const bytes = yield* nodeIo((signal) =>
    readFile(artifact.absolutePath, { signal }),
  );

  if (sha256(bytes) !== artifact.hash) {
    return {
      kind: 'unavailable',
      reason: 'Artifact changed while being inspected',
    } as const;
  }

  return { kind: 'available', text: bytes.toString('utf8') } as const;
});

export const inspectSide = Effect.fn('inspectSide')(function* ({
  directory,
  prefix,
  evaluatedAt,
  expected,
}: InspectSideOptions) {
  yield* Schema.decodeUnknownEffect(timestamp)(evaluatedAt);

  if (directory === null) {
    return unavailable('No capture directory supplied');
  }

  if (!safeRelativePath(prefix)) {
    return unavailable('Unsafe evidence URL prefix');
  }

  return yield* Effect.gen(function* () {
    const root = yield* nodeIo(() => realpath(directory));

    const manifestArtifact = yield* inspectArtifact(root, {
      id: 'capture',
      path: 'capture.json',
      description: 'Capture manifest',
      ...(expected === undefined ? {} : { sha256: expected.manifestHash }),
    });

    if (manifestArtifact.kind === 'unavailable') {
      return unavailable(
        `Capture manifest unavailable: ${manifestArtifact.reason}`,
      );
    }

    const manifestText = yield* readVerifiedText(manifestArtifact);

    if (manifestText.kind === 'unavailable') {
      return unavailable(manifestText.reason);
    }

    const parsed = yield* parseCapture(manifestText.text).pipe(
      Effect.map((capture) => ({ kind: 'parsed', capture }) as const),
      Effect.catchTags({
        SchemaError: () =>
          Effect.succeed({
            kind: 'invalid',
            reason: 'Capture manifest is malformed or unsupported',
          } as const),
        UnsupportedCapture: ({ message }) =>
          Effect.succeed({ kind: 'invalid', reason: message } as const),
      }),
    );

    if (parsed.kind === 'invalid') {
      return unavailable(parsed.reason);
    }

    const capture = parsed.capture;
    const reasons: string[] = [];

    if (
      expected !== undefined &&
      expected.sourceHash !== capture.source.sha256
    ) {
      reasons.push('Source snapshot does not match the selected sourceHash');
    }

    const inspected = yield* Effect.forEach(capture.artifacts, (artifact) =>
      inspectArtifact(root, artifact),
    );

    const byId = new Map(inspected.map((item) => [item.artifact.id, item]));
    const byPath = new Map(inspected.map((item) => [item.artifact.path, item]));

    const artifacts = inspected.map((item): Side['artifacts'][number] => {
      if (item.kind === 'unavailable') {
        reasons.push(`${item.artifact.id}: ${item.reason}`);
      }

      return describeArtifact(item, prefix);
    });

    // A failed capture stops before writing these; its failure is the reason.
    for (const id of capture.execution.kind === 'failed'
      ? []
      : requiredArtifacts) {
      if (!byId.has(id)) {
        reasons.push(`Required artifact is missing: ${id}`);
      }
    }

    const recipeArtifact = byId.get('recipe');
    let recipe: Recipe | null = null;

    if (
      recipeArtifact?.kind === 'available' &&
      recipeArtifact.hash !== capture.recipe.sha256
    ) {
      reasons.push(
        'Recipe artifact bytes do not match the protected recipe SHA-256',
      );
    }

    if (
      recipeArtifact?.kind === 'available' &&
      recipeArtifact.hash === capture.recipe.sha256
    ) {
      const saved = yield* readVerifiedText(recipeArtifact);

      if (saved.kind === 'available') {
        recipe = yield* parseRecipe(saved.text).pipe(
          Effect.catchTag('SchemaError', () => Effect.succeed(null)),
        );
      }

      if (recipe === null || recipe.id !== capture.recipe.id) {
        reasons.push(
          'Protected recipe is malformed or its identity does not match the capture',
        );
      }
    }

    reasons.push(...captureProblems(capture, evaluatedAt, recipe));

    for (const file of capture.source.files) {
      const artifact = byPath.get(`source/${file.path}`);

      if (!safeRelativePath(file.path)) {
        reasons.push(`Unsafe source file path: ${file.path}`);
      } else if (artifact === undefined) {
        reasons.push(`Source file artifact is missing: source/${file.path}`);
      } else if (
        artifact.kind === 'available' &&
        artifact.hash !== file.sha256
      ) {
        reasons.push(`Source file SHA-256 mismatch: source/${file.path}`);
      }
    }

    let observations: Observations | null = null;
    const observationArtifact = byId.get('observations');

    if (observationArtifact?.kind === 'available') {
      const text = yield* readVerifiedText(observationArtifact);

      if (text.kind === 'unavailable') {
        reasons.push(`Observations unavailable: ${text.reason}`);
      } else {
        observations = yield* parseObservations(text.text).pipe(
          Effect.catchTag('SchemaError', () => Effect.succeed(null)),
        );

        if (observations === null) {
          reasons.push('Observations are malformed or unsupported');
        } else {
          reasons.push(...observationProblems(capture, observations, recipe));
        }
      }
    }

    const screenshotArtifact = artifacts.find(
      (artifact) => artifact.id === 'screenshot',
    );
    const screenshot =
      screenshotArtifact?.integrity === 'verified'
        ? screenshotArtifact.path
        : null;
    const captured = { manifest: capture, sha256: manifestArtifact.hash };
    const errors =
      observations?.browserErrors.map(
        (error) =>
          `Browser error: ${error.trim() === '' ? '(empty message)' : error.trim()}`,
      ) ?? [];
    const evidence = { artifacts, unresolved: [...reasons, ...errors] };
    const checks = unknownChecks(
      reasons.length === 0 ? 'Observations unavailable' : reasons.join('; '),
      recipe,
    );

    if (capture.execution.kind === 'failed') {
      return {
        execution: 'capture-failed',
        capture: captured,
        recipe,
        evidence:
          recipe === null ? [] : yield* evidenceViews(capture, recipe, byPath),
        screenshot,
        checks,
        ...evidence,
      } satisfies Side;
    }

    if (
      reasons.length === 0 &&
      observations !== null &&
      recipe !== null &&
      screenshot !== null
    ) {
      const views = yield* evidenceViews(capture, recipe, byPath);

      const side = {
        execution: 'complete',
        capture: captured,
        recipe,
        observations,
        evidence: views,
        screenshot,
        checks: [],
        ...evidence,
        unresolved: errorsListed(views) ? reasons : evidence.unresolved,
      } satisfies Side;

      const { executed, imported } = evaluatePairs(
        null,
        side,
        'preview',
        false,
      );

      return {
        ...side,
        checks: [...executed, ...imported].map((pair) => pair.candidate),
      } satisfies Side;
    }

    return {
      execution: 'unavailable',
      capture: captured,
      recipe,
      screenshot,
      checks,
      ...evidence,
    } satisfies Side;
  }).pipe(
    Effect.catchTag('EvidenceIoError', (error) =>
      Effect.succeed(
        unavailable(`Capture evidence could not be read (${error.code})`),
      ),
    ),
  );
});

// Browser errors stay unresolved unless verified, complete browser-errors
// evidence already lists them.
function errorsListed(views: readonly EvidenceView[]): boolean {
  return views.some(
    (view) =>
      view.kind === 'browser-errors' &&
      view.status === 'recorded' &&
      view.value.coverage.kind === 'complete',
  );
}

function sideAt(side: Side, evaluatedAt: string): Side {
  if (side.execution !== 'complete') {
    return side;
  }

  const reasons = captureProblems(
    side.capture.manifest,
    evaluatedAt,
    side.recipe,
  );

  if (reasons.length === 0) {
    return side;
  }

  return {
    execution: 'unavailable',
    capture: side.capture,
    recipe: side.recipe,
    screenshot: side.screenshot,
    checks: unknownChecks(reasons.join('; '), side.recipe),
    artifacts: side.artifacts,
    unresolved: [...side.unresolved, ...reasons],
  };
}

function evidenceIdentity(entry: Capture['evidence'][number]) {
  return entry.status === 'recorded'
    ? {
        schemaVersion: entry.schemaVersion,
        producer: entry.producer,
        conditions: entry.conditions,
      }
    : { schemaVersion: entry.schemaVersion, producer: entry.producer };
}

function comparisonProblems(base: Side, candidate: Side): string[] {
  const reasons: string[] = [];

  const unusable = (side: Side) =>
    side.execution !== 'complete' ||
    side.artifacts.some((artifact) => artifact.integrity !== 'verified');

  if (
    unusable(base) &&
    unusable(candidate) &&
    sideDetail(base) === sideDetail(candidate)
  ) {
    reasons.push(
      `Base and candidate unavailable for the same reason: ${sideDetail(base)}`,
    );
  } else {
    for (const [name, side] of [
      ['Base', base],
      ['Candidate', candidate],
    ] as const) {
      if (unusable(side)) {
        reasons.push(`${name} unavailable: ${sideDetail(side)}`);
      }
    }
  }

  if (base.capture !== null && candidate.capture !== null) {
    const before = base.capture.manifest;
    const after = candidate.capture.manifest;

    if (before.application !== after.application) {
      reasons.push('Captures belong to different applications');
    }

    if (!isDeepStrictEqual(before.recipe, after.recipe)) {
      reasons.push('Capture recipes differ');
    }

    if (!isDeepStrictEqual(before.producer, after.producer)) {
      reasons.push('Capture producers differ');
    }

    if (before.observed.version !== after.observed.version) {
      reasons.push(
        `Observed versions differ (base ${before.observed.version}, candidate ${after.observed.version}), so observations may be derived differently`,
      );
    }

    if (
      !isDeepStrictEqual(
        comparableConditions(before),
        comparableConditions(after),
      )
    ) {
      reasons.push('Capture conditions differ');
    }

    for (const entry of after.evidence) {
      const other = before.evidence.find((item) => item.kind === entry.kind);

      if (
        other !== undefined &&
        other.status === entry.status &&
        !isDeepStrictEqual(evidenceIdentity(other), evidenceIdentity(entry))
      ) {
        reasons.push(
          `${entry.kind} evidence was recorded under different versions or conditions`,
        );
      }
    }

    // Imported tests may be added or removed by the change itself; each is
    // matched by ID when its checks are evaluated.
    const configured = (side: Side) =>
      side.checks
        .filter((check) => check.authority !== importedAuthority)
        .map((check) => check.id);

    if (!isDeepStrictEqual(configured(base), configured(candidate))) {
      reasons.push('Named check identities differ');
    }
  }

  return reasons;
}

function observedSourceNotes(base: Side, candidate: Side): string[] {
  const before = base.capture?.manifest.observed;
  const after = candidate.capture?.manifest.observed;

  if (
    before === undefined ||
    after === undefined ||
    before.version !== after.version
  ) {
    return [];
  }

  const sides = [
    { name: 'base', source: before.source },
    { name: 'candidate', source: after.source },
  ] as const;
  const notes: string[] = [];
  const unknown = sides.flatMap(({ name, source }) =>
    source.kind === 'unavailable' ? [{ name, reason: source.reason }] : [],
  );

  const [first, second] = unknown;

  if (first !== undefined) {
    const subject =
      second === undefined ? `the ${first.name} capture` : 'both captures';

    notes.push(
      `Observed's source commit is unknown for ${subject}, so the same Observed ${after.version} code cannot be confirmed on both sides. ${second !== undefined && first.reason === second.reason ? `Both: ${first.reason}` : unknown.map(({ name, reason }) => `${name}: ${reason}`).join('; ')}.`,
    );
  } else if (
    before.source.kind === 'git' &&
    after.source.kind === 'git' &&
    before.source.commit !== after.source.commit
  ) {
    notes.push(
      `Both captures report Observed ${after.version}, but from different commits (base ${before.source.commit}, candidate ${after.source.commit}), so the observations may come from different code.`,
    );
  }

  for (const side of sides) {
    if (side.source.kind === 'git' && side.source.trackedChanges) {
      notes.push(
        `The ${side.name} capture ran Observed ${after.version} with uncommitted tracked changes, so commit ${side.source.commit} does not identify its code.`,
      );
    }
  }

  return notes;
}

function verdictsFor(
  pairs: readonly CheckPair[] | null,
  candidate: Side,
): CheckVerdict[] {
  const identity = (check: Check) => ({
    id: check.id,
    name: check.name,
    scope: check.scope,
    expectation: check.expectation,
  });

  if (pairs === null) {
    return candidate.checks.map((check) => ({
      ...identity(check),
      verdict: 'unknown',
      detail: check.detail,
    }));
  }

  return pairs.map(({ candidate: check, regression, measure, recipe }) => {
    const common = {
      ...identity(check),
      ...(measure === undefined ? {} : { measure }),
      ...(recipe === undefined ? {} : { recipe }),
    };

    if (regression !== null) {
      return { ...common, verdict: 'regression', detail: regression };
    }

    return { ...common, verdict: check.outcome, detail: check.detail };
  });
}

// Keeps a conclusion about a large imported suite short enough to deliver.
// The report still lists every check.
const listedChecks = 10;

function names(verdicts: readonly CheckVerdict[]): string {
  const shown = verdicts.slice(0, listedChecks).map((verdict) => verdict.name);
  const hidden = verdicts.length - shown.length;

  return hidden > 0
    ? `${shown.join(', ')} and ${hidden} more`
    : shown.join(', ');
}

function sentences(
  parts: readonly string[],
  rest: (count: number) => string,
): string {
  const hidden = parts.length - listedChecks;

  return [
    ...parts.slice(0, listedChecks),
    ...(hidden > 0 ? [rest(hidden)] : []),
  ].join(' ');
}

function notComparedLead(base: Side, candidate: Side): string {
  const baseFailed = base.execution === 'capture-failed';
  const candidateFailed = candidate.execution === 'capture-failed';

  if (baseFailed && candidateFailed) {
    return 'Both captures failed, so the revisions were not compared.';
  }

  if (baseFailed || candidateFailed) {
    return `The ${baseFailed ? 'base' : 'candidate'} capture failed, so the revisions were not compared.`;
  }

  return 'The revisions were not compared.';
}

function runConclusionText(
  journeys: Comparison['journeys'],
  deciding: readonly Journey[],
  mode: 'preview' | 'comparison',
): string {
  const [first] = journeys;

  if (journeys.length === 1 && first !== undefined) {
    return first.conclusion.text;
  }

  if (everyCaptureFailed(journeys, mode)) {
    const unknown = journeys
      .flatMap((journey) => journey.checks)
      .filter((item) => item.verdict === 'unknown').length;
    const checks =
      unknown === 0
        ? ''
        : ` ${unknown} ${unknown === 1 ? 'check is' : 'checks are'} unknown.`;

    return `Every capture failed, so no journey was ${mode === 'preview' ? 'checked' : 'compared'}.${checks}`;
  }

  return deciding
    .map((journey) => `${journey.title}: ${journey.conclusion.text}`)
    .join(' ');
}

const proposedOutcomes = {
  passed: 'passed',
  failed: 'failed',
  unknown: 'is unknown',
  'not-run': 'did not run',
} satisfies Record<Proposed['outcome'], string>;

const addedText = 'This change adds the check, so it has no baseline.';

function recipeNote({ recipe, verdict }: CheckVerdict): string {
  const proposal = proposedOf(recipe);

  switch (recipe?.change) {
    case undefined:
    case 'added':
      return '';
    case 'altered':
    case 'journey-altered':
      return proposal === undefined
        ? ''
        : ` The candidate's proposed version ${proposedOutcomes[proposal.outcome]} and sets no verdict.`;
    case 'removed':
      return verdict === 'unknown'
        ? ''
        : " This change removes the check, so the base's definition judged both captures.";
    case 'test-file-changed':
      return verdict === 'passed' ? ' This change alters its test file.' : '';
    default:
      return recipe satisfies never;
  }
}

function journeyConclusion(
  base: Side,
  candidate: Side,
  verdicts: readonly CheckVerdict[],
  comparison: Journey['comparison'],
  mode: 'preview' | 'comparison',
): Conclusion {
  const regressions = verdicts.filter((item) => item.verdict === 'regression');
  const failed = verdicts.filter((item) => item.verdict === 'failed');
  const unknown = verdicts.filter((item) => item.verdict === 'unknown');
  const passed = verdicts.filter((item) => item.verdict === 'passed');
  const notRun = verdicts.filter((item) => item.verdict === 'not-run');
  const notRunText = notRun.length === 0 ? '' : ` Not run: ${names(notRun)}.`;
  const baseCheck = (id: string) =>
    base.checks.find((check) => check.id === id);
  const candidateCheck = (id: string) =>
    candidate.checks.find((check) => check.id === id);
  const baseOutcome = (id: string) =>
    ({
      passed: 'passed',
      failed: 'failed',
      'not-run': 'was not run',
      unknown: 'was unknown',
    })[baseCheck(id)?.outcome ?? 'unknown'];

  if (regressions.length > 0) {
    return {
      kind: 'regression',
      text: sentences(
        regressions.map((item) => `${item.detail}${recipeNote(item)}`),
        (count) =>
          `${count} more ${count === 1 ? 'check' : 'checks'} regressed.`,
      ),
    };
  }

  if (failed.length > 0) {
    return {
      kind: 'check-failed',
      text: sentences(
        failed.map((item) => {
          const after = candidateCheck(item.id);

          if (mode === 'preview') {
            return `${item.name}: failed.`;
          }

          if (item.recipe?.change === 'added') {
            return `${item.name} failed. ${addedText} Candidate: ${describeActual(after)}. ${item.expectation}`;
          }

          if (comparison.kind !== 'available') {
            return `${item.name} failed. The revisions were not compared, so a regression cannot be established. Candidate: ${describeActual(after)}. ${item.expectation}${recipeNote(item)}`;
          }

          const readings = {
            failed: 'Base also failed, so a regression is not established.',
            passed:
              "Base passed, but the check's regression rule did not establish a regression.",
            'not-run':
              'Base was not run, so a regression cannot be established.',
            unknown: 'Base was unknown, so a regression cannot be established.',
          } as const;
          const before = baseCheck(item.id);
          const reading = readings[before?.outcome ?? 'unknown'];

          // An imported check's detail says why no regression was
          // established when base passed or had no result.
          if (after?.authority === importedAuthority) {
            return `${item.name} failed. ${before === undefined || before.outcome === 'passed' ? '' : `${reading} `}${item.detail}`;
          }

          return `${item.name} failed. ${reading} Base: ${describeActual(before)}; candidate: ${describeActual(after)}. ${item.expectation}${recipeNote(item)}`;
        }),
        (count) => `${count} more ${count === 1 ? 'check' : 'checks'} failed.`,
      ),
    };
  }

  if (mode === 'preview' && candidate.execution !== 'complete') {
    return {
      kind: 'unavailable',
      text:
        candidate.execution === 'capture-failed'
          ? 'The capture failed. Nothing was checked.'
          : 'The capture is unavailable. Nothing was checked.',
    };
  }

  if (comparison.kind === 'unavailable') {
    const lead = notComparedLead(base, candidate);

    return {
      kind: 'unavailable',
      text:
        unknown.length > 0
          ? `${lead} Unknown: ${names(unknown)}.`
          : `${lead}${verdicts.length === 0 ? '' : ` ${passed.length} of ${verdicts.length} candidate checks passed.`}${notRunText}`,
    };
  }

  if (unknown.length > 0) {
    return {
      kind: 'unavailable',
      text: sentences(
        unknown.map(
          (item) => `${item.name}: unknown. ${item.detail}${recipeNote(item)}`,
        ),
        (count) =>
          `${count} more ${count === 1 ? 'check is' : 'checks are'} unknown.`,
      ).concat(notRunText),
    };
  }

  if (passed.length === 0) {
    if (mode === 'preview') {
      return {
        kind: 'preview',
        text: `Current application capture.${notRunText}`,
      };
    }

    return {
      kind: 'not-checked',
      text:
        notRun.length === 0
          ? 'Before and after captured. No named check is configured, so no behavior was checked.'
          : `Before and after captured. No named check ran, so no behavior was checked.${notRunText}`,
    };
  }

  if (mode === 'preview') {
    return {
      kind: 'preview',
      text: `${sentences(
        passed.map((item) => `${item.name}: passed.`),
        (count) => `${count} more ${count === 1 ? 'check' : 'checks'} passed.`,
      )}${notRunText}`,
    };
  }

  return {
    kind: 'no-regression',
    text: sentences(
      passed.map((item) => {
        if (item.recipe?.change === 'added') {
          return `${item.name} passed on the candidate. ${addedText}`;
        }

        return baseOutcome(item.id) === 'passed'
          ? `${item.name} passed on base and candidate.${recipeNote(item)}`
          : `${item.name} ${baseOutcome(item.id)} on base and passed on candidate.${recipeNote(item)}`;
      }),
      (count) =>
        `${count} more ${count === 1 ? 'check' : 'checks'} passed on the candidate.`,
    ).concat(notRunText),
  };
}

export function compareJourney({
  base: inspectedBase,
  candidate: inspectedCandidate,
  evaluatedAt,
  visual,
  mode = 'comparison',
  sources = { base: null, candidate: null },
  judgement = { kind: 'not-compared' },
  generatedJourney,
}: {
  base: Side;
  candidate: Side;
  evaluatedAt: string;
  visual: Visual;
  mode?: 'preview' | 'comparison';
  sources?: { base: SideSource | null; candidate: SideSource | null };
  judgement?: JourneyJudgement;
  generatedJourney?: JourneySelection['generated'];
}): Journey {
  const base = sideAt(inspectedBase, evaluatedAt);
  const candidate = sideAt(inspectedCandidate, evaluatedAt);
  const reasons =
    mode === 'comparison' ? comparisonProblems(base, candidate) : [];
  const [firstReason, ...otherReasons] = reasons;

  let comparison: Journey['comparison'];

  if (mode === 'preview' && candidate.execution === 'complete') {
    comparison = { kind: 'preview' };
  } else if (mode === 'preview') {
    comparison = {
      kind: 'unavailable',
      reasons: [`Capture unavailable: ${sideDetail(candidate)}`],
    };
  } else if (
    firstReason !== undefined ||
    base.execution !== 'complete' ||
    candidate.execution !== 'complete'
  ) {
    comparison = {
      kind: 'unavailable',
      reasons: [
        firstReason ?? 'Comparable captures unavailable',
        ...otherReasons,
      ],
    };
  } else {
    comparison = {
      kind: 'available',
      basis:
        'Complete, intact captures with the same protected recipe, application, producer, Observed version, and recorded conditions.',
      requestDifference:
        candidate.observations.requests.length -
        base.observations.requests.length,
      visual,
    };
  }

  const evaluated =
    candidate.execution === 'complete'
      ? evaluatePairs(
          mode === 'comparison' && base.execution === 'complete' ? base : null,
          candidate,
          mode,
          comparison.kind === 'available',
          candidate.recipe.generated === undefined
            ? judgement
            : { kind: 'not-compared' },
        )
      : null;
  const pairs =
    evaluated === null ? null : [...evaluated.executed, ...evaluated.imported];
  const verdicts = verdictsFor(pairs, candidate);
  const withChecks = (side: Side, checks: Check[] | undefined): Side =>
    checks === undefined || side.execution !== 'complete'
      ? side
      : { ...side, checks };
  const bases = (list: readonly CheckPair[]) =>
    list.flatMap((pair) => (pair.base === null ? [] : [pair.base]));

  // A complete base has a result for every executed check it defines; an
  // imported test the base did not report keeps the base's own list.
  const evaluatedBase = withChecks(
    base,
    evaluated === null
      ? undefined
      : [
          ...bases(evaluated.executed),
          ...(evaluated.imported.every((pair) => pair.base !== null)
            ? bases(evaluated.imported)
            : base.checks.filter(
                (check) => check.authority === importedAuthority,
              )),
        ],
  );
  const redefined = verdicts.some(
    (verdict) =>
      verdict.recipe !== undefined &&
      verdict.recipe.change !== 'test-file-changed',
  );

  if (redefined && comparison.kind === 'available') {
    comparison = {
      ...comparison,
      basis:
        "Complete, intact captures of the candidate's journey, with the same application, producer, Observed version, and recorded conditions. The base's observed.json defines this journey differently.",
    };
  }

  const evaluatedCandidate = withChecks(
    candidate,
    pairs?.map((pair) => pair.candidate),
  );

  const generated =
    candidate.recipe?.generated ??
    base.recipe?.generated ??
    (generatedJourney === undefined
      ? undefined
      : { targets: generatedJourney.targets, reason: generatedJourney.reason });
  const journey = {
    ...(generated === undefined ? {} : { generated }),
    title: `${candidate.recipe?.name ?? base.recipe?.name ?? generatedJourney?.name ?? 'Before and after'}${generated === undefined ? '' : ' (generated)'}`,
    base: evaluatedBase,
    candidate: evaluatedCandidate,
    comparison,
    checks: verdicts,
    conclusion: journeyConclusion(
      evaluatedBase,
      evaluatedCandidate,
      verdicts,
      comparison,
      mode,
    ),
    limitations: [
      ...(generated === undefined
        ? []
        : [
            'Generated journey: agent interpretation. Only executed baseline checks set verdicts; other differences remain observations.',
          ]),
      'Checks cover only their stated expectations and scopes. Browser errors remain available as evidence.',
      'Screenshot differences are observations of rendered pixels, not a visual regression.',
      'Artifact hashes detect changed bytes; they do not establish collector honesty or source causation.',
      ...(mode === 'comparison' ? observedSourceNotes(base, candidate) : []),
    ],
  };

  return { ...journey, findings: journeyFindings(journey, sources) };
}

const notRecorded = {
  recipe:
    'observed.json was not read from the base revision, because this comparison was made from capture directories',
  coverage: {
    kind: 'unavailable',
    reason: 'Coverage was not read for this comparison',
  },
  changes: {
    kind: 'unavailable',
    reason:
      'Git did not list changed files for this comparison, because it was made from capture directories',
  },
} as const;

export function summarizeJourneys({
  journeys,
  evaluatedAt,
  mode,
  scope = changeScope({
    mode,
    journeys: journeys.map((journey) => ({
      journey,
      sources: { base: null, candidate: null },
      coverage: notRecorded.coverage,
    })),
    changes: notRecorded.changes,
    recipe: { kind: 'unavailable', reason: notRecorded.recipe },
  }),
  removedJourneys = [],
}: {
  journeys: readonly [Journey, ...Journey[]];
  evaluatedAt: string;
  mode: 'preview' | 'comparison';
  scope?: ChangeScope;
  removedJourneys?: Comparison['removedJourneys'];
}): Comparison {
  const [first] = journeys;
  const unjudged = removedJourneys.filter(
    (journey) => journey.checks.length > 0,
  );
  const kinds = [
    ...journeys.map((journey) => journey.conclusion.kind),
    ...(unjudged.length > 0 ? (['unavailable'] as const) : []),
  ];
  const kind =
    conclusionKinds.find((candidate) => kinds.includes(candidate)) ??
    first.conclusion.kind;
  const deciding = journeys.filter(
    (journey) => journey.conclusion.kind === kind,
  );
  const verdicts = runVerdicts({ journeys, removedJourneys });
  const removedText = unjudged.map(
    (journey) =>
      `${journey.journey}: this change removes the journey, so no capture ran its checks. Unknown: ${names(journey.checks)}.`,
  );

  return {
    schemaVersion: resultSchemaVersion,
    mode,
    title:
      journeys.length === 1
        ? first.title
        : (first.candidate.capture?.manifest.application ??
          `${journeys.length} journeys`),
    evaluatedAt,
    journeys,
    summary: {
      passed: verdicts.filter((item) => item.verdict === 'passed').length,
      total: verdicts.length,
    },
    conclusion: {
      kind,
      text: [runConclusionText(journeys, deciding, mode), ...removedText]
        .filter((part) => part !== '')
        .join(' '),
    },
    changeScope: scope,
    removedJourneys,
    changeMap:
      scope.kind === 'unavailable'
        ? scope
        : {
            kind: 'unavailable',
            reason: 'The change map is built only from capture directories.',
          },
  };
}

export function compareCaptures(options: {
  base: Side;
  candidate: Side;
  evaluatedAt: string;
  visual: Visual;
  mode?: 'preview' | 'comparison';
}): Comparison {
  return summarizeJourneys({
    journeys: [compareJourney(options)],
    evaluatedAt: options.evaluatedAt,
    mode: options.mode ?? 'comparison',
  });
}

function noVisual(reason: string): { visual: Visual; diff: null } {
  return { visual: { kind: 'unavailable', reason }, diff: null };
}

const loadScreenshot = Effect.fnUntraced(function* (
  directory: string,
  side: Extract<Side, { execution: 'complete' }>,
  label: string,
) {
  const artifact = side.capture.manifest.artifacts.find(
    (item) => item.id === 'screenshot',
  );

  if (artifact === undefined) {
    return {
      kind: 'unsupported',
      reason: `${label} screenshot is missing`,
    } satisfies DecodedPng;
  }

  const root = yield* nodeIo(() => realpath(directory));
  const read = yield* readVerifiedArtifact(root, artifact);
  const decoded =
    read.kind === 'available'
      ? decodePng(read.bytes)
      : ({ kind: 'unsupported', reason: read.reason } satisfies DecodedPng);

  return decoded.kind === 'decoded'
    ? decoded
    : ({
        kind: 'unsupported',
        reason: `${label} screenshot: ${decoded.reason}`,
      } satisfies DecodedPng);
});

const inspectVisual = Effect.fnUntraced(
  function* (
    baseDirectory: string | null,
    candidateDirectory: string,
    base: Side,
    candidate: Side,
  ) {
    if (
      baseDirectory === null ||
      base.execution !== 'complete' ||
      candidate.execution !== 'complete'
    ) {
      return noVisual('Complete screenshots on both sides are required');
    }

    const before = yield* loadScreenshot(baseDirectory, base, 'Base');

    if (before.kind === 'unsupported') {
      return noVisual(before.reason);
    }

    const after = yield* loadScreenshot(
      candidateDirectory,
      candidate,
      'Candidate',
    );

    if (after.kind === 'unsupported') {
      return noVisual(after.reason);
    }

    return comparePixels(before.image, after.image);
  },
  Effect.catchTag('EvidenceIoError', (error) =>
    Effect.succeed(noVisual(`Screenshot could not be read (${error.code})`)),
  ),
);

const readArtifactText = Effect.fnUntraced(function* (
  root: string,
  artifact: CaptureArtifact,
) {
  const read = yield* readVerifiedArtifact(root, artifact);

  return read.kind === 'available'
    ? new TextDecoder().decode(read.bytes)
    : null;
});

// The verified source snapshot and source maps of one capture, read only
// when every snapshot file is intact.
const loadSideSource = Effect.fnUntraced(
  function* (directory: string | null, side: Side) {
    if (directory === null || side.execution === 'unavailable') {
      return null;
    }

    const root = yield* nodeIo(() => realpath(directory));
    const { manifest } = side.capture;
    const byPath = new Map(
      manifest.artifacts.map((artifact) => [artifact.path, artifact]),
    );
    const links = new Map(
      side.artifacts.flatMap((artifact) =>
        artifact.integrity === 'verified' ? [[artifact.id, artifact.path]] : [],
      ),
    );
    const files = new Map<string, string>();

    for (const file of manifest.source.files) {
      const artifact = byPath.get(`source/${file.path}`);
      const content =
        artifact === undefined || artifact.sha256 !== file.sha256
          ? null
          : yield* readArtifactText(root, artifact);

      if (content === null) {
        return null;
      }

      files.set(file.path, content);
    }

    const indexArtifact = byPath.get(sourceMapIndexPath);
    const indexText =
      indexArtifact === undefined
        ? null
        : yield* readArtifactText(root, indexArtifact);
    const index =
      indexText === null
        ? null
        : Option.getOrNull(
            Schema.decodeUnknownOption(
              Schema.fromJsonString(sourceMapIndexSchema),
            )(indexText),
          );

    if (index === null) {
      return {
        files,
        maps: {
          kind: 'unavailable',
          reason:
            indexArtifact === undefined
              ? 'The capture has no source map index; it predates source maps or fetching them failed'
              : 'The source map index is unreadable',
        },
      } satisfies SideSource;
    }

    const scripts = new Map<string, ScriptMap>();

    for (const entry of index.scripts) {
      if (entry.map.kind === 'unavailable') {
        scripts.set(entry.script, entry.map);
        continue;
      }

      const artifact = byPath.get(entry.map.path);
      const text =
        artifact === undefined ? null : yield* readArtifactText(root, artifact);
      const map = text === null ? null : parseSourceMap(text);
      const link = artifact === undefined ? undefined : links.get(artifact.id);

      scripts.set(
        entry.script,
        map === null || link === undefined
          ? {
              kind: 'unavailable',
              reason: `The source map of ${entry.script} is missing or unreadable`,
            }
          : { kind: 'recorded', map, artifact: link },
      );
    }

    return {
      files,
      maps: { kind: 'recorded', origin: index.origin, scripts },
    } satisfies SideSource;
  },
  Effect.catchTag('EvidenceIoError', () => Effect.succeed(null)),
);

const unreadCoverage = (reason: string): CoverageRecord => ({
  kind: 'unavailable',
  reason,
});

const loadCoverage = Effect.fnUntraced(
  function* (directory: string, side: Side) {
    if (side.execution !== 'complete') {
      return unreadCoverage('The candidate capture is not complete');
    }

    const { manifest } = side.capture;
    const entry = manifest.evidence.find((item) => item.kind === 'coverage');

    if (entry === undefined) {
      return unreadCoverage('The capture recorded no coverage');
    }

    if (entry.status === 'unavailable') {
      return unreadCoverage(entry.reason);
    }

    if (entry.schemaVersion !== coverageSchemaVersion) {
      return unreadCoverage(
        `Coverage schema version ${entry.schemaVersion} is unsupported`,
      );
    }

    const artifact = manifest.artifacts.find(
      (item) => item.path === entry.path && item.sha256 === entry.sha256,
    );
    const root = yield* nodeIo(() => realpath(directory));
    const content =
      artifact === undefined ? null : yield* readArtifactText(root, artifact);

    return content === null
      ? unreadCoverage('The coverage file is missing or changed')
      : parseCoverage(content);
  },
  Effect.catchTag('EvidenceIoError', () =>
    Effect.succeed(unreadCoverage('The coverage file could not be read')),
  ),
);

export const inspectJourney = Effect.fn('inspectJourney')(function* ({
  baseDirectory,
  candidateDirectory,
  evaluatedAt,
  mode = 'comparison',
  selection,
  judge = () => ({ kind: 'not-compared' }),
}: {
  baseDirectory: string | null;
  candidateDirectory: string;
  evaluatedAt: string;
  mode?: 'preview' | 'comparison';
  selection?: JourneySelection;
  judge?: (journey: string) => JourneyJudgement;
}) {
  const prefix = (side: 'base' | 'candidate') =>
    selection === undefined ? side : `${selection.directory}/${side}`;
  const base =
    selection?.baseIssue === undefined
      ? yield* inspectSide({
          directory: baseDirectory,
          prefix: prefix('base'),
          evaluatedAt,
          ...(selection === undefined || selection.base === null
            ? {}
            : { expected: selection.base }),
        })
      : yield* inspectFailureSide(
          baseDirectory,
          prefix('base'),
          selection.baseIssue,
          selection.baseFailureArtifacts,
        );

  const candidate =
    selection?.candidateIssue === undefined
      ? yield* inspectSide({
          directory: candidateDirectory,
          prefix: prefix('candidate'),
          evaluatedAt,
          ...(selection === undefined || selection.candidate === null
            ? {}
            : { expected: selection.candidate }),
        })
      : yield* inspectFailureSide(
          candidateDirectory,
          prefix('candidate'),
          selection.candidateIssue,
          selection.candidateFailureArtifacts,
        );

  const pixels =
    mode === 'comparison'
      ? yield* inspectVisual(baseDirectory, candidateDirectory, base, candidate)
      : noVisual('Preview has no baseline');
  const diffPath =
    selection === undefined
      ? 'visual-diff.png'
      : `${selection.directory}/visual-diff.png`;
  const visual: Visual =
    pixels.visual.kind === 'changed'
      ? { ...pixels.visual, diff: { ...pixels.visual.diff, path: diffPath } }
      : pixels.visual;
  const sources = {
    base:
      mode === 'comparison' ? yield* loadSideSource(baseDirectory, base) : null,
    candidate: yield* loadSideSource(candidateDirectory, candidate),
  };
  const journey = compareJourney({
    base,
    candidate,
    evaluatedAt,
    visual,
    mode,
    sources,
    generatedJourney: selection?.generated,
    judgement:
      candidate.recipe === null
        ? { kind: 'not-compared' }
        : judge(candidate.recipe.name),
  });
  const scope: ScopeJourney = {
    journey,
    sources,
    coverage: yield* loadCoverage(candidateDirectory, candidate),
  };

  return {
    journey,
    scope,
    repositorySnapshot: sources.candidate === null ? null : {
      journey,
      source: { root: path.join(candidateDirectory, 'source'), files: sources.candidate.files },
    },
    snapshots:
      sources.base === null ||
      sources.candidate === null ||
      baseDirectory === null
        ? null
        : {
            journey,
            base: {
              root: path.join(baseDirectory, 'source'),
              files: sources.base.files,
            },
            candidate: {
              root: path.join(candidateDirectory, 'source'),
              files: sources.candidate.files,
            },
          },
    visualDiff:
      journey.comparison.kind === 'available' && pixels.diff !== null
        ? { path: diffPath, bytes: pixels.diff.bytes }
        : null,
  };
});

// Journeys only the base defines were never captured, so each check is
// unknown.
export function removedJourneys(
  removed: RecipePlan['removed'],
): Comparison['removedJourneys'] {
  const detail =
    'This change removes the journey, so no capture ran this check.';

  return removed.map((journey) => ({
    journey: journey.journey,
    checks: [
      ...journey.checks.map((definition) => ({
        ...definition,
        expectation: expectationFor(definition),
      })),
      ...(journey.imports ? [unknownRun(detail)] : []),
    ].map(({ id, name, scope, expectation }) => ({
      id,
      name,
      scope,
      expectation,
      verdict: 'unknown',
      detail,
      recipe: { change: 'removed' },
    })),
  }));
}

// Inspects each selected journey under root/<directory>/{base,candidate}.
export const inspectComparison = Effect.fn('inspectComparison')(function* ({
  root,
  selection,
}: {
  root: string;
  selection: Selection;
}) {
  const plan = recipePlan(selection.recipes, notRecorded.recipe);
  const inspected = yield* Effect.forEach(selection.journeys, (journey) =>
    inspectJourney({
      judge: plan.judge,
      baseDirectory:
        selection.mode === 'preview'
          ? null
          : path.join(root, journey.directory, 'base'),
      candidateDirectory: path.join(root, journey.directory, 'candidate'),
      evaluatedAt: selection.evaluatedAt,
      mode: selection.mode,
      selection: journey,
    }),
  );
  const [first, ...rest] = inspected.map((item) => item.journey);

  if (first === undefined) {
    return yield* Effect.die('A selection has at least one journey');
  }

  const changes: GitChanges = selection.changes ?? notRecorded.changes;

  const scope = changeScope({
    mode: selection.mode,
    journeys: inspected.map((item) => item.scope),
    changes,
    recipe: plan.scope,
  });

  const map = changeMap({
    scope,
    journeys: inspected.map((item) => item.scope),
    snapshots:
      inspected.find((item) => item.snapshots !== null)?.snapshots ?? null,
  });
  const savedCount = inspected.filter(
    (item) => item.journey.generated === undefined,
  ).length;
  const repository = repositoryMap({
    journeys: inspected.map((item) => item.scope),
    snapshot: inspected.find((item) => item.repositorySnapshot !== null)?.repositorySnapshot ?? null,
  });
  const descriptions = selection.agentDescriptions;
  const problem = descriptions === undefined ? null : descriptionProblem(descriptions, repository, map);

  if (problem !== null) {
    return yield* new DescriptionFailure({ message: problem });
  }

  return {
    result: {
      ...summarizeJourneys({
        journeys: [
          proposeSaving(first, 0, map, savedCount),
          ...rest.map((journey, index) =>
            proposeSaving(journey, index + 1, map, savedCount),
          ),
        ],
        evaluatedAt: selection.evaluatedAt,
        mode: selection.mode,
        scope,
        removedJourneys:
          selection.mode === 'preview' ? [] : removedJourneys(plan.removed),
      }),
      changeMap: map,
      repositoryMap: repository,
      ...(descriptions === undefined ? {} : { agentDescriptions: descriptions }),
    },
    visualDiffs: inspected.flatMap((item) =>
      item.visualDiff === null ? [] : [item.visualDiff],
    ),
  };
});
