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
import { json, sha256 } from './encoding';
import type {
  Check,
  Comparison,
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
import { describeObserved } from './provenance-text';
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

function expectation(recipe: Recipe | null): string {
  const definition = recipe?.check;

  if (definition === undefined || definition === null) {
    return 'No named expectation available.';
  }

  if (definition.kind === 'request-count') {
    return `Exactly ${definition.expectedCount} ${definition.method} ${definition.origin ?? ''}${definition.path} request(s) with status ${definition.status}.`;
  }

  return `Exactly one ${definition.selector} element with text ${JSON.stringify(definition.expectedText)}.`;
}

function unknownCheck(
  detail: string,
  recipe: Recipe | null = null,
): UnknownCheck {
  const definition = recipe?.check;

  return {
    id: definition?.id ?? 'capture-evidence',
    name: definition?.name ?? 'Capture evidence',
    authority: 'Executed by Observed',
    scope:
      definition?.scope ?? 'The configured page and recorded capture window.',
    expectation: expectation(recipe),
    outcome: 'unknown',
    actual: null,
    detail,
  };
}

function evaluateCheck(recipe: Recipe, observations: Observations): Check {
  const definition = recipe.check;
  const common = unknownCheck('Required check observation unavailable', recipe);

  if (definition === null) {
    return {
      ...common,
      name: 'No check configured',
      outcome: 'not-run',
      detail:
        'These captures show the application. No correctness check was configured.',
    };
  }

  if (definition.kind === 'text') {
    const observed = observations.text;

    if (observed === undefined || observed.selector !== definition.selector) {
      return common;
    }

    return {
      ...common,
      outcome:
        observed.count === 1 && observed.value === definition.expectedText
          ? 'passed'
          : 'failed',
      actual: observed.value,
      detail: `Matched ${observed.count} element(s); text: ${JSON.stringify(observed.value)}.`,
    };
  }

  const requests = observations.requests.filter(
    (request) =>
      request.method === definition.method &&
      request.path === definition.path &&
      request.origin === (definition.origin ?? 'application'),
  );
  const successful = requests.every(
    (request) => request.status === definition.status,
  );
  const statuses =
    requests.length === 0
      ? 'none'
      : requests.map((request) => request.status).join(', ');

  return {
    ...common,
    outcome:
      requests.length === definition.expectedCount && successful
        ? 'passed'
        : 'failed',
    actual: requests.length,
    detail: `Observed ${requests.length} matching ${definition.method} ${definition.origin ?? ''}${definition.path} request(s); statuses: ${statuses}.`,
  };
}

function comparableConditions(capture: Capture) {
  if (capture.conditions.kind === 'unavailable') {
    return capture.conditions;
  }

  return { ...capture.conditions.value, dependenciesHash: null };
}

function conclusion(
  base: Side,
  candidate: Side,
  regression: boolean,
): Comparison['conclusion'] {
  if (candidate.check.outcome === 'not-run') {
    return {
      kind: 'not-checked',
      text: 'Before and after captured. No named check was configured.',
    };
  }

  if (regression) {
    return {
      kind: 'regression',
      text: `${candidate.check.name} regressed. Base: ${String(base.check.actual)}; candidate: ${String(candidate.check.actual)}. ${candidate.check.expectation}`,
    };
  }

  if (candidate.check.outcome === 'failed') {
    return {
      kind: 'check-failed',
      text: `${candidate.check.name} failed. Base also failed, so this is not a regression. Base: ${String(base.check.actual)}; candidate: ${String(candidate.check.actual)}. ${candidate.check.expectation}`,
    };
  }

  return {
    kind: 'no-regression',
    text: `No passing-to-failed transition in ${candidate.check.name}. Base: ${base.check.outcome}; candidate: ${candidate.check.outcome}.`,
  };
}

function previewConclusion(check: Check): Comparison['conclusion'] {
  switch (check.outcome) {
    case 'not-run':
      return { kind: 'preview', text: 'Current application capture.' };
    case 'passed':
      return { kind: 'preview', text: `${check.name}: passed.` };
    case 'failed':
      return { kind: 'check-failed', text: `${check.name}: failed.` };
    case 'unknown':
      return {
        kind: 'unavailable',
        text: `${check.name}: unknown. ${check.detail}`,
      };
  }
}

function unavailable(reason: string): Side {
  return {
    execution: 'unavailable',
    capture: null,
    recipe: null,
    screenshot: null,
    check: unknownCheck(reason),
    artifacts: [],
    unresolved: [reason],
  };
}

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
    const check = unknownCheck(
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
        screenshot,
        check,
        ...evidence,
      } satisfies Side;
    }

    if (
      reasons.length === 0 &&
      observations !== null &&
      recipe !== null &&
      screenshot !== null
    ) {
      return {
        execution: 'complete',
        capture: captured,
        recipe,
        observations,
        screenshot,
        check: evaluateCheck(recipe, observations),
        ...evidence,
      } satisfies Side;
    }

    return {
      execution: 'unavailable',
      capture: captured,
      recipe,
      screenshot,
      check,
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
    check: unknownCheck(reasons.join('; '), side.recipe),
    artifacts: side.artifacts,
    unresolved: [...side.unresolved, ...reasons],
  };
}

function comparisonProblems(base: Side, candidate: Side): string[] {
  const reasons: string[] = [];

  for (const [name, side] of [
    ['Base', base],
    ['Candidate', candidate],
  ] as const) {
    if (
      side.execution !== 'complete' ||
      side.check.outcome === 'unknown' ||
      side.artifacts.some((artifact) => artifact.integrity !== 'verified')
    ) {
      reasons.push(`${name} unavailable: ${side.check.detail}`);
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

    if (base.check.id !== candidate.check.id) {
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
    before.version !== after.version ||
    isDeepStrictEqual(before.source, after.source)
  ) {
    return [];
  }

  return [
    `Both captures report Observed ${after.version} from different sources, so their observations may come from different code. Base: ${describeObserved(before)}. Candidate: ${describeObserved(after)}.`,
  ];
}

export function compareCaptures({
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
}): Comparison {
  const base = sideAt(inspectedBase, evaluatedAt);
  const candidate = sideAt(inspectedCandidate, evaluatedAt);
  const reasons = comparisonProblems(base, candidate);
  const firstReason = reasons[0];

  const common = {
    schemaVersion: 5,
    mode,
    title: candidate.recipe?.name ?? base.recipe?.name ?? 'Before and after',
    evaluatedAt,
    base,
    candidate,
    limitations: [
      candidate.recipe?.check?.scope ??
        'Only the configured page and recorded capture window were captured.',
      'Checks cover only their stated expectations. Browser errors remain available as evidence.',
      'Screenshot differences are observations of rendered pixels, not a visual regression.',
      'Artifact hashes detect changed bytes; they do not establish collector honesty or source causation.',
      ...(mode === 'comparison' ? observedSourceNotes(base, candidate) : []),
    ],
  } as const;

  if (mode === 'preview' && candidate.execution === 'complete') {
    return {
      ...common,
      comparison: { kind: 'preview' },
      conclusion: previewConclusion(candidate.check),
    };
  }

  if (mode === 'preview') {
    return {
      ...common,
      comparison: {
        kind: 'unavailable',
        reasons: [`Capture unavailable: ${candidate.check.detail}`],
      },
      conclusion: {
        kind: 'unavailable',
        text: `Capture unavailable: ${candidate.check.detail}`,
      },
    };
  }

  if (
    firstReason !== undefined ||
    base.execution !== 'complete' ||
    candidate.execution !== 'complete'
  ) {
    return {
      ...common,
      comparison: {
        kind: 'unavailable',
        reasons: [
          firstReason ?? 'Comparable captures unavailable',
          ...reasons.slice(1),
        ],
      },
      conclusion:
        candidate.check.outcome === 'failed'
          ? {
              kind: 'check-failed',
              text: `${candidate.check.name} failed. Revision comparison unavailable, so a regression cannot be established. Candidate: ${String(candidate.check.actual)}. ${candidate.check.expectation}`,
            }
          : {
              kind: 'unavailable',
              text: `Revision comparison unavailable. Candidate check: ${candidate.check.outcome}.`,
            },
    };
  }

  const regression =
    base.check.outcome === 'passed' && candidate.check.outcome === 'failed';

  return {
    ...common,
    comparison: {
      kind: 'available',
      basis:
        'Complete, intact captures with the same protected recipe, application, producer, Observed version, and recorded conditions.',
      requestDifference:
        candidate.observations.requests.length -
        base.observations.requests.length,
      visual,
    },
    conclusion: conclusion(base, candidate, regression),
  };
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

export const inspectComparison = Effect.fn('inspectComparison')(function* ({
  baseDirectory,
  candidateDirectory,
  evaluatedAt,
  selection,
}: {
  baseDirectory: string | null;
  candidateDirectory: string;
  evaluatedAt: string;
  selection?: Selection;
}) {
  const base =
    selection?.baseIssue === undefined
      ? yield* inspectSide({
          directory: baseDirectory,
          prefix: 'base',
          evaluatedAt,
          ...(selection === undefined || selection.base === null
            ? {}
            : { expected: selection.base }),
        })
      : yield* inspectFailureSide(
          baseDirectory,
          'base',
          selection.baseIssue,
          selection.baseFailureArtifacts,
        );

  const candidate =
    selection?.candidateIssue === undefined
      ? yield* inspectSide({
          directory: candidateDirectory,
          prefix: 'candidate',
          evaluatedAt,
          ...(selection === undefined || selection.candidate === null
            ? {}
            : { expected: selection.candidate }),
        })
      : yield* inspectFailureSide(
          candidateDirectory,
          'candidate',
          selection.candidateIssue,
          selection.candidateFailureArtifacts,
        );

  const mode = selection?.mode ?? 'comparison';
  const pixels =
    mode === 'comparison'
      ? yield* inspectVisual(baseDirectory, candidateDirectory, base, candidate)
      : noVisual('Preview has no baseline');
  const result = compareCaptures({
    base,
    candidate,
    evaluatedAt,
    visual: pixels.visual,
    mode,
  });

  return {
    result,
    visualDiff: result.comparison.kind === 'available' ? pixels.diff : null,
  };
});
