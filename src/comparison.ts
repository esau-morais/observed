import { checkLabels } from './result-text';
import { DateTime, Effect, Schema } from 'effect';
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
import type { CheckInput, Evaluation } from './checks/define';
import {
  evidenceKinds,
  evidenceViewSchema,
  isEvidenceKind,
  type EvidenceKind,
  type EvidenceView,
} from './evidence-kinds';
import { json, sha256 } from './encoding';
import path from 'node:path';
import type {
  Check,
  CheckVerdict,
  Comparison,
  Conclusion,
  Journey,
  JourneySelection,
  Selection,
  Side,
  SideArtifact,
  UnknownCheck,
  Visual,
} from './comparison-model';
import {
  inspectArtifact,
  readVerifiedArtifact,
  type ArtifactResult,
} from './evidence';
import { nodeIo } from './node-io';
import { decodePng, type DecodedPng } from './png';
import { relativePathSchema } from './project';
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

  return recipe.checks.map((definition) => ({
    id: definition.id,
    name: definition.name,
    authority: 'Executed by Observed',
    scope: definition.scope,
    expectation: expectationFor(definition),
    outcome: 'unknown',
    actual: null,
    detail,
  }));
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

  // The loop above supplied every declared kind; evaluators read only those.
  return {
    kind: 'ready',
    input: {
      observations: side.observations,
      evidence: evidence as CheckInput<EvidenceKind>['evidence'],
    },
  };
}

function checkResult(
  definition: CheckDefinition,
  evaluation: Evaluation,
): Check {
  const identity = {
    id: definition.id,
    name: definition.name,
    authority: 'Executed by Observed',
    scope: definition.scope,
    expectation: expectationFor(definition),
    detail: evaluation.detail,
  } as const;

  return evaluation.outcome === 'passed' || evaluation.outcome === 'failed'
    ? { ...identity, outcome: evaluation.outcome, actual: evaluation.actual }
    : { ...identity, outcome: evaluation.outcome, actual: null };
}

type CheckPair = {
  definition: CheckDefinition;
  base: { check: Check; input: CheckInput<EvidenceKind> | null } | null;
  candidate: { check: Check; input: CheckInput<EvidenceKind> | null };
};

function evaluateDefinition<K extends CheckDefinition['kind']>(
  definition: Extract<CheckDefinition, { kind: K }>,
  base: CompleteSide | null,
  candidate: CompleteSide,
): CheckPair {
  const kind: CheckKinds[K] = checkKinds[definition.kind];
  const baseInput = base === null ? null : checkInput(base, kind.evidence);
  const candidateInput = checkInput(candidate, kind.evidence);
  const missing = (detail: string): Evaluation => ({
    outcome: 'unknown',
    actual: null,
    detail,
  });

  const evaluated =
    candidateInput.kind === 'ready'
      ? kind.evaluate({
          definition,
          base: baseInput?.kind === 'ready' ? baseInput.input : null,
          candidate: candidateInput.input,
        })
      : null;

  const candidateEvaluation =
    candidateInput.kind === 'missing'
      ? missing(candidateInput.detail)
      : (evaluated?.candidate ?? missing('Candidate evaluation unavailable'));

  let baseEvaluation: Evaluation | null = null;

  if (baseInput !== null) {
    baseEvaluation =
      baseInput.kind === 'missing'
        ? missing(baseInput.detail)
        : (evaluated?.base ??
          (candidateInput.kind === 'missing'
            ? kind.evaluate({
                definition,
                base: null,
                candidate: baseInput.input,
              }).candidate
            : missing('Base evaluation unavailable')));
  }

  return {
    definition,
    base:
      baseEvaluation === null
        ? null
        : {
            check: checkResult(definition, baseEvaluation),
            input: baseInput?.kind === 'ready' ? baseInput.input : null,
          },
    candidate: {
      check: checkResult(definition, candidateEvaluation),
      input: candidateInput.kind === 'ready' ? candidateInput.input : null,
    },
  };
}

function evaluatePairs(
  base: CompleteSide | null,
  candidate: CompleteSide,
): CheckPair[] {
  return candidate.recipe.checks.map((definition) =>
    evaluateDefinition(definition, base, candidate),
  );
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
  }

  if (capture.conditions.kind === 'unavailable') {
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

    for (const id of requiredArtifacts) {
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
    const evidence = {
      artifacts,
      unresolved: [
        ...reasons,
        ...(observations?.browserErrors.map(
          (error) =>
            `Browser error: ${error.trim() === '' ? '(empty message)' : error.trim()}`,
        ) ?? []),
      ],
    };
    const checks = unknownChecks(
      reasons.length === 0
        ? 'Verified observations unavailable'
        : reasons.join('; '),
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
      } satisfies Side;

      return {
        ...side,
        checks: evaluatePairs(null, side).map((pair) => pair.candidate.check),
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

  for (const [name, side] of [
    ['Base', base],
    ['Candidate', candidate],
  ] as const) {
    if (
      side.execution !== 'complete' ||
      side.artifacts.some((artifact) => artifact.integrity !== 'verified')
    ) {
      reasons.push(`${name} unavailable: ${sideDetail(side)}`);
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

    if (
      !isDeepStrictEqual(
        base.checks.map((check) => check.id),
        candidate.checks.map((check) => check.id),
      )
    ) {
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
      `Observed's source commit is unknown for ${subject}, so the same Observed ${after.version} code cannot be confirmed on both sides. ${unknown.map(({ name, reason }) => `${name}: ${reason}`).join('; ')}.`,
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

function describeActual(check: Check | undefined): string {
  return check === undefined || check.actual === null
    ? 'unknown'
    : String(check.actual);
}

function verdictsFor(
  pairs: readonly CheckPair[] | null,
  candidate: Side,
  mode: 'preview' | 'comparison',
  comparable: boolean,
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

  return pairs.map(({ definition, base: before, candidate: after }) => {
    const check = after.check;
    const common = identity(check);

    if (check.outcome === 'unknown' || check.outcome === 'not-run') {
      return {
        ...common,
        verdict: check.outcome,
        detail: check.detail,
      };
    }

    if (
      mode === 'comparison' &&
      comparable &&
      before !== null &&
      before.input !== null &&
      after.input !== null &&
      (before.check.outcome === 'passed' || before.check.outcome === 'failed')
    ) {
      const regression = regressionOf(definition, before, after);

      if (regression !== null) {
        return { ...common, verdict: 'regression', detail: regression };
      }
    }

    return { ...common, verdict: check.outcome, detail: check.detail };
  });
}

function regressionOf<K extends CheckDefinition['kind']>(
  definition: Extract<CheckDefinition, { kind: K }>,
  before: { check: Check; input: CheckInput<EvidenceKind> | null },
  after: { check: Check; input: CheckInput<EvidenceKind> | null },
): string | null {
  const kind: CheckKinds[K] = checkKinds[definition.kind];
  const evaluation = (check: Check): Evaluation => ({
    outcome: check.outcome,
    actual: check.actual,
    detail: check.detail,
  });

  if (before.input === null || after.input === null) {
    return null;
  }

  if (kind.regression !== undefined) {
    return (
      kind.regression({
        definition,
        base: { ...before.input, evaluation: evaluation(before.check) },
        candidate: { ...after.input, evaluation: evaluation(after.check) },
      })?.detail ?? null
    );
  }

  return before.check.outcome === 'passed' && after.check.outcome === 'failed'
    ? `${after.check.name} passed on base and failed on candidate. Base: ${describeActual(before.check)}; candidate: ${describeActual(after.check)}. ${after.check.expectation}`
    : null;
}

function names(verdicts: readonly CheckVerdict[]): string {
  return verdicts.map((verdict) => verdict.name).join(', ');
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
  const baseCheck = (id: string) =>
    base.checks.find((check) => check.id === id);
  const candidateCheck = (id: string) =>
    candidate.checks.find((check) => check.id === id);

  if (regressions.length > 0) {
    return {
      kind: 'regression',
      text: regressions.map((item) => item.detail).join(' '),
    };
  }

  if (failed.length > 0) {
    return {
      kind: 'check-failed',
      text: failed
        .map((item) => {
          const after = candidateCheck(item.id);

          if (mode === 'preview') {
            return `${item.name}: failed.`;
          }

          return comparison.kind === 'available'
            ? `${item.name} failed. Base ${baseCheck(item.id)?.outcome === 'failed' ? 'also failed' : 'did not pass'}, so this is not a regression. Base: ${describeActual(baseCheck(item.id))}; candidate: ${describeActual(after)}. ${item.expectation}`
            : `${item.name} failed. The revisions were not compared, so a regression cannot be established. Candidate: ${describeActual(after)}. ${item.expectation}`;
        })
        .join(' '),
    };
  }

  if (mode === 'preview' && candidate.execution !== 'complete') {
    return {
      kind: 'unavailable',
      text: 'The capture is unavailable. Nothing was checked.',
    };
  }

  if (comparison.kind === 'unavailable') {
    return {
      kind: 'unavailable',
      text:
        unknown.length > 0
          ? `The revisions were not compared. Unknown: ${names(unknown)}.`
          : `The revisions were not compared. ${passed.length} of ${verdicts.length} candidate checks passed.`,
    };
  }

  if (unknown.length > 0) {
    return {
      kind: 'unavailable',
      text: unknown
        .map((item) => `${item.name}: unknown. ${item.detail}`)
        .join(' '),
    };
  }

  if (passed.length === 0) {
    return mode === 'preview'
      ? { kind: 'preview', text: 'Current application capture.' }
      : {
          kind: 'not-checked',
          text: 'Before and after captured. No named check is configured, so no behavior was verified.',
        };
  }

  if (mode === 'preview') {
    return {
      kind: 'preview',
      text: passed.map((item) => `${item.name}: passed.`).join(' '),
    };
  }

  return {
    kind: 'no-regression',
    text: passed
      .map((item) =>
        baseCheck(item.id)?.outcome === 'passed'
          ? `${item.name} passed on base and candidate.`
          : `${item.name} failed on base and passed on candidate.`,
      )
      .join(' '),
  };
}

export function compareJourney({
  base: inspectedBase,
  candidate: inspectedCandidate,
  evaluatedAt,
  visual,
  mode = 'comparison',
}: {
  base: Side;
  candidate: Side;
  evaluatedAt: string;
  visual: Visual;
  mode?: 'preview' | 'comparison';
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

  const pairs =
    candidate.execution === 'complete'
      ? evaluatePairs(
          mode === 'comparison' && base.execution === 'complete' ? base : null,
          candidate,
        )
      : null;
  const verdicts = verdictsFor(
    pairs,
    candidate,
    mode,
    comparison.kind === 'available',
  );
  const withChecks = (side: Side, checks: Check[] | undefined): Side =>
    checks === undefined || side.execution !== 'complete'
      ? side
      : { ...side, checks };

  return {
    title: candidate.recipe?.name ?? base.recipe?.name ?? 'Before and after',
    base: withChecks(
      base,
      pairs?.every((pair) => pair.base !== null) === true
        ? pairs.flatMap((pair) => (pair.base === null ? [] : [pair.base.check]))
        : undefined,
    ),
    candidate: withChecks(
      candidate,
      pairs?.map((pair) => pair.candidate.check),
    ),
    comparison,
    checks: verdicts,
    conclusion: journeyConclusion(base, candidate, verdicts, comparison, mode),
    limitations: [
      'Checks cover only their stated expectations and scopes. Browser errors remain available as evidence.',
      'Screenshot differences are observations of rendered pixels, not a visual regression.',
      'Artifact hashes detect changed bytes; they do not establish collector honesty or source causation.',
      ...(mode === 'comparison' ? observedSourceNotes(base, candidate) : []),
    ],
  };
}

const conclusionOrder = [
  'regression',
  'check-failed',
  'unavailable',
  'no-regression',
  'not-checked',
  'preview',
] as const satisfies readonly Conclusion['kind'][];

export function summarizeJourneys({
  journeys,
  evaluatedAt,
  mode,
}: {
  journeys: readonly [Journey, ...Journey[]];
  evaluatedAt: string;
  mode: 'preview' | 'comparison';
}): Comparison {
  const [first] = journeys;
  const kind =
    conclusionOrder.find((candidate) =>
      journeys.some((journey) => journey.conclusion.kind === candidate),
    ) ?? first.conclusion.kind;
  const deciding = journeys.filter(
    (journey) => journey.conclusion.kind === kind,
  );
  const verdicts = journeys.flatMap((journey) => journey.checks);

  return {
    schemaVersion: 6,
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
      text:
        journeys.length === 1
          ? first.conclusion.text
          : deciding
              .map((journey) => `${journey.title}: ${journey.conclusion.text}`)
              .join(' '),
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

export const inspectJourney = Effect.fn('inspectJourney')(function* ({
  baseDirectory,
  candidateDirectory,
  evaluatedAt,
  mode = 'comparison',
  selection,
}: {
  baseDirectory: string | null;
  candidateDirectory: string;
  evaluatedAt: string;
  mode?: 'preview' | 'comparison';
  selection?: JourneySelection;
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
  const journey = compareJourney({
    base,
    candidate,
    evaluatedAt,
    visual,
    mode,
  });

  return {
    journey,
    visualDiff:
      journey.comparison.kind === 'available' && pixels.diff !== null
        ? { path: diffPath, bytes: pixels.diff.bytes }
        : null,
  };
});

// Inspects each selected journey under root/<directory>/{base,candidate}.
export const inspectComparison = Effect.fn('inspectComparison')(function* ({
  root,
  selection,
}: {
  root: string;
  selection: Selection;
}) {
  const inspected = yield* Effect.forEach(selection.journeys, (journey) =>
    inspectJourney({
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

  return {
    result: summarizeJourneys({
      journeys: [first, ...rest],
      evaluatedAt: selection.evaluatedAt,
      mode: selection.mode,
    }),
    visualDiffs: inspected.flatMap((item) =>
      item.visualDiff === null ? [] : [item.visualDiff],
    ),
  };
});
