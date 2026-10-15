import { DateTime } from 'effect';
import { isDeepStrictEqual } from 'node:util';
import type { Capture, Observations } from './capture';
import { checkKind, type CheckDefinition } from './checks';
import type { CheckIdentity, CheckInput, CheckKind, Evaluation } from './checks/define';
import {
  importedAuthority,
  playwrightPairs,
  unknownPlaywrightChecks,
  unknownRun,
} from './checks/playwright';
import { evidenceKinds, isEvidenceKind, type EvidenceKind } from './evidence';
import type { EvidenceView } from './evidence';
import { json, sha256 } from './hash';
import type { Recipe } from './recipe';
import type {
  Check,
  CheckPair,
  CheckVerdict,
  Comparison,
  Conclusion,
  Journey,
  JourneySelection,
  Proposed,
  Side,
  UnknownCheck,
  VerdictRecipe,
  Visual,
} from './result';
import { conclusionKinds } from './result';
import type { JourneyJudgement, RecipePlan } from './revisions';
import { sameDefinition } from './revisions';
import {
  comparedBasis,
  journeyAlteredDetail,
  redefinedBasis,
  regressionDetail,
  removedJourneyDetail,
  unreadableBaseDetail,
} from './words';

// Verdicts from parsed captures. Nothing here reads files or writes the
// conclusion's sentences, and no model takes part.

export type CompleteSide = Extract<Side, { execution: 'complete' }>;

export type Mode = Comparison['mode'];

export type Sides = {
  base: CompleteSide | null;
  candidate: CompleteSide;
  mode: Mode;
  comparable: boolean;
};

export function expectationFor(definition: CheckDefinition): string {
  return checkKind(definition).expectation(definition);
}

// The checks a side shows when nothing could be evaluated on it.
export function unknownChecks(detail: string, recipe: Recipe | null = null): UnknownCheck[] {
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

export function unavailableSide(reason: string): Side {
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

function sideDetail(side: Side): string {
  const unknown = side.checks.find((check) => check.outcome === 'unknown');

  return unknown?.detail ?? side.unresolved.join('; ');
}

// Declared evidence for one check on one side, or why it is missing.
function checkInput(
  side: CompleteSide,
  kinds: readonly EvidenceKind[],
): { kind: 'ready'; input: CheckInput<EvidenceKind> } | { kind: 'missing'; detail: string } {
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

const unknownEvaluation = (detail: string): Evaluation => ({
  outcome: 'unknown',
  actual: null,
  detail,
});

function reading(evaluation: Evaluation | null): string | null {
  if (evaluation === null || (evaluation.outcome !== 'passed' && evaluation.outcome !== 'failed')) {
    return null;
  }

  return (
    evaluation.reading ?? (typeof evaluation.actual === 'number' ? String(evaluation.actual) : null)
  );
}

// Evaluates one configured check on both sides through its kind. Missing
// declared evidence makes that side unknown before the kind sees it, and a
// kind that compares the sides gets no verdict from an unusable base.
export function evaluateCheck<D extends CheckIdentity>(
  kind: CheckKind<D, EvidenceKind>,
  definition: D,
  { base, candidate, mode, comparable }: Sides,
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
    baseEvaluation === null ? null : checkResult(definition, expectation, baseEvaluation);
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
      regression = regressionDetail(before, after, expectation);
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

function evaluateDefinition(definition: CheckDefinition, sides: Sides): CheckPair {
  return evaluateCheck(checkKind(definition), definition, sides);
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
  const check = checkResult(definition, expectationFor(definition), unknownEvaluation(detail));

  return {
    base: check,
    candidate: check,
    regression: null,
    ...(recipe === undefined ? {} : { recipe }),
  };
}

// The base's definition of a check judges both captures. A check only the
// candidate defines has no baseline, and a journey whose fields changed
// leaves every check unknown, since its captures follow the candidate's
// journey.
function executedPairs(sides: Sides, judgement: JourneyJudgement): CheckPair[] {
  const evaluate = (definition: CheckDefinition) => evaluateDefinition(definition, sides);
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
      unknownPair(definition, unreadableBaseDetail(judgement.reason)),
    );
  }

  const baseOnly = judgement.base.filter(
    (definition) => !captured.some((item) => item.id === definition.id),
  );
  const [field, ...fields] = judgement.fields;

  if (field !== undefined) {
    const detail = journeyAlteredDetail([field, ...fields]);

    return [
      ...captured.map((definition) =>
        unknownPair(
          judgement.base.find((item) => item.id === definition.id) ?? definition,
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
function judgedImports(pairs: readonly CheckPair[], judgement: JourneyJudgement): CheckPair[] {
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
      return pairs.map((pair) => unknown(pair, unreadableBaseDetail(judgement.reason)));
    case 'compared': {
      const [field, ...fields] = judgement.fields;

      return field === undefined
        ? [...pairs]
        : pairs.map((pair) => ({
            ...unknown(pair, journeyAlteredDetail([field, ...fields])),
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

export function evaluatePairs(
  sides: Sides,
  judgement: JourneyJudgement = { kind: 'not-compared' },
): { executed: CheckPair[]; imported: CheckPair[] } {
  const judged: JourneyJudgement = sides.mode === 'preview' ? { kind: 'not-compared' } : judgement;

  return {
    executed: executedPairs(sides, judged),
    imported: judgedImports(playwrightPairs(sides), judged),
  };
}

// The checks a complete side shows on its own, before any comparison.
export function previewChecks(side: CompleteSide): Check[] {
  const { executed, imported } = evaluatePairs({
    base: null,
    candidate: side,
    mode: 'preview',
    comparable: false,
  });

  return [...executed, ...imported].map((pair) => pair.candidate);
}

// Problems that make a parsed capture unusable at `evaluatedAt`: a failed
// run, missing conditions, an age outside the recipe's limit, or a source
// snapshot whose hash does not match its files.
export function captureProblems(
  capture: Capture,
  evaluatedAt: string,
  recipe: Recipe | null,
): string[] {
  const reasons: string[] = [];

  if (capture.execution.kind === 'failed') {
    reasons.push(`Capture failed (${capture.execution.category}): ${capture.execution.reason}`);
  } else if (capture.conditions.kind === 'unavailable') {
    reasons.push(`Capture conditions unavailable: ${capture.conditions.reason}`);
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
    reasons.push('Source snapshot SHA-256 does not match its entry and sorted files');
  }

  if (!files.some((file) => file.path === capture.source.entry)) {
    reasons.push('Source entry is missing from source.files');
  }

  return reasons;
}

export function observationProblems(
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

  if (startedAt > finishedAt || startedAt < capture.startedAt || finishedAt > capture.finishedAt) {
    return ['Observation window is inverted or outside the capture interval'];
  }

  if (
    observations.requests.some(
      (request) => request.startedAt < startedAt || request.startedAt > finishedAt,
    )
  ) {
    return ['A request timestamp is outside the observation window'];
  }

  return [];
}

// Browser errors stay unresolved unless verified, complete browser-errors
// evidence already lists them.
export function errorsListed(views: readonly EvidenceView[]): boolean {
  return views.some(
    (view) =>
      view.kind === 'browser-errors' &&
      view.status === 'recorded' &&
      view.value.coverage.kind === 'complete',
  );
}

// Rechecks a complete side's age and integrity at `evaluatedAt`.
function sideAt(side: Side, evaluatedAt: string): Side {
  if (side.execution !== 'complete') {
    return side;
  }

  const reasons = captureProblems(side.capture.manifest, evaluatedAt, side.recipe);

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

function comparableConditions(capture: Capture) {
  if (capture.conditions.kind === 'unavailable') {
    return capture.conditions;
  }

  return { ...capture.conditions.value, dependenciesHash: null };
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

// Why two sides cannot be compared. Empty when they can.
export function comparisonProblems(base: Side, candidate: Side): string[] {
  const reasons: string[] = [];

  const unusable = (side: Side) =>
    side.execution !== 'complete' ||
    side.artifacts.some((artifact) => artifact.integrity !== 'verified');

  if (unusable(base) && unusable(candidate) && sideDetail(base) === sideDetail(candidate)) {
    reasons.push(`Base and candidate unavailable for the same reason: ${sideDetail(base)}`);
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

    for (const [name, capture] of [
      ['Base', before],
      ['Candidate', after],
    ] as const) {
      for (const entry of capture.evidence) {
        if (!isEvidenceKind(entry.kind)) {
          reasons.push(`${name} evidence kind ${entry.kind} is unsupported`);
        }
      }
    }

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

    if (!isDeepStrictEqual(comparableConditions(before), comparableConditions(after))) {
      reasons.push('Capture conditions differ');
    }

    for (const entry of after.evidence) {
      const other = before.evidence.find((item) => item.kind === entry.kind);

      if (
        other !== undefined &&
        other.status === entry.status &&
        !isDeepStrictEqual(evidenceIdentity(other), evidenceIdentity(entry))
      ) {
        reasons.push(`${entry.kind} evidence was recorded under different versions or conditions`);
      }
    }

    // Imported tests may be added or removed by the change itself; each is
    // matched by ID when its checks are evaluated.
    const configured = (side: Side) =>
      side.checks.filter((check) => check.authority !== importedAuthority).map((check) => check.id);

    if (!isDeepStrictEqual(configured(base), configured(candidate))) {
      reasons.push('Named check identities differ');
    }
  }

  return reasons;
}

function verdictsFor(pairs: readonly CheckPair[] | null, candidate: Side): CheckVerdict[] {
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

// One journey's conclusion. A regression outranks a failure, and any unknown
// check keeps the journey from passing.
export function conclusionKind({
  candidate,
  checks,
  comparison,
  mode,
}: Pick<Journey, 'candidate' | 'checks' | 'comparison'> & {
  mode: Mode;
}): Conclusion['kind'] {
  const has = (verdict: CheckVerdict['verdict']) => checks.some((item) => item.verdict === verdict);

  if (has('regression')) {
    return 'regression';
  }

  if (has('failed')) {
    return 'check-failed';
  }

  if (
    (mode === 'preview' && candidate.execution !== 'complete') ||
    comparison.kind === 'unavailable' ||
    has('unknown')
  ) {
    return 'unavailable';
  }

  if (mode === 'preview') {
    return 'preview';
  }

  return has('passed') ? 'no-regression' : 'not-checked';
}

// The run's conclusion: the first kind any journey reaches, in precedence
// order. A removed journey with checks keeps the run unavailable.
export function runConclusionKind({
  journeys,
  removedJourneys,
}: {
  journeys: readonly [
    { conclusion: { kind: Conclusion['kind'] } },
    ...{ conclusion: { kind: Conclusion['kind'] } }[],
  ];
  removedJourneys: Comparison['removedJourneys'];
}): Conclusion['kind'] {
  const kinds = [
    ...journeys.map((journey) => journey.conclusion.kind),
    ...(removedJourneys.some((journey) => journey.checks.length > 0)
      ? (['unavailable'] as const)
      : []),
  ];

  return (
    conclusionKinds.find((candidate) => kinds.includes(candidate)) ?? journeys[0].conclusion.kind
  );
}

export type JudgedJourney = Omit<Journey, 'conclusion' | 'limitations'> & {
  conclusion: { kind: Conclusion['kind'] };
};

export function judgeJourney({
  base: inspectedBase,
  candidate: inspectedCandidate,
  evaluatedAt,
  visual,
  mode = 'comparison',
  judgement = { kind: 'not-compared' },
  generatedJourney,
}: {
  base: Side;
  candidate: Side;
  evaluatedAt: string;
  visual: Visual;
  mode?: Mode;
  judgement?: JourneyJudgement;
  generatedJourney?: JourneySelection['generated'];
}): JudgedJourney {
  const base = sideAt(inspectedBase, evaluatedAt);
  const candidate = sideAt(inspectedCandidate, evaluatedAt);
  const reasons = mode === 'comparison' ? comparisonProblems(base, candidate) : [];
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
      reasons: [firstReason ?? 'Comparable captures unavailable', ...otherReasons],
    };
  } else {
    comparison = {
      kind: 'available',
      basis: comparedBasis,
      requestDifference: candidate.observations.requests.length - base.observations.requests.length,
      visual,
    };
  }

  const evaluated =
    candidate.execution === 'complete'
      ? evaluatePairs(
          {
            base: mode === 'comparison' && base.execution === 'complete' ? base : null,
            candidate,
            mode,
            comparable: comparison.kind === 'available',
          },
          candidate.recipe.generated === undefined ? judgement : { kind: 'not-compared' },
        )
      : null;
  const pairs = evaluated === null ? null : [...evaluated.executed, ...evaluated.imported];
  const verdicts = verdictsFor(pairs, candidate);
  const withChecks = (side: Side, checks: Check[] | undefined): Side =>
    checks === undefined || side.execution !== 'complete' ? side : { ...side, checks };
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
            : base.checks.filter((check) => check.authority === importedAuthority)),
        ],
  );
  const redefined = verdicts.some(
    (verdict) => verdict.recipe !== undefined && verdict.recipe.change !== 'test-file-changed',
  );

  if (redefined && comparison.kind === 'available') {
    comparison = { ...comparison, basis: redefinedBasis };
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

  return {
    ...(generated === undefined ? {} : { generated }),
    title: `${candidate.recipe?.name ?? base.recipe?.name ?? generatedJourney?.name ?? 'Before and after'}${generated === undefined ? '' : ' (generated)'}`,
    base: evaluatedBase,
    candidate: evaluatedCandidate,
    comparison,
    checks: verdicts,
    conclusion: {
      kind: conclusionKind({
        candidate: evaluatedCandidate,
        checks: verdicts,
        comparison,
        mode,
      }),
    },
  };
}

// Journeys only the base defines were never captured, so each check is
// unknown.
export function removedJourneys(removed: RecipePlan['removed']): Comparison['removedJourneys'] {
  return removed.map((journey) => ({
    journey: journey.journey,
    checks: [
      ...journey.checks.map((definition) => ({
        ...definition,
        expectation: expectationFor(definition),
      })),
      ...(journey.imports ? [unknownRun(removedJourneyDetail)] : []),
    ].map(({ id, name, scope, expectation }) => ({
      id,
      name,
      scope,
      expectation,
      verdict: 'unknown',
      detail: removedJourneyDetail,
      recipe: { change: 'removed' },
    })),
  }));
}
