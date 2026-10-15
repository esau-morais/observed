import { Effect, Schema } from 'effect';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  parseCapture,
  parseObservations,
  relativePathSchema,
  timestamp,
  type Capture,
  type CaptureArtifact,
  type Observations,
} from './capture';
import { compareJourney, notComparedReason, summarizeJourneys } from './compare';
import {
  evidenceKinds,
  evidenceViewSchema,
  isEvidenceKind,
  type EvidenceKind,
  type EvidenceView,
} from './evidence';
import { sha256 } from './hash';
import { inspectArtifact, nodeIo, readVerifiedArtifact, type ArtifactResult } from './io';
import {
  captureProblems,
  errorsListed,
  observationProblems,
  previewChecks,
  removedJourneys,
  unavailableSide,
  unknownChecks,
  type Mode,
} from './judge';
import { decodePng, type DecodedPng } from './png';
import { parseRecipe, type Recipe } from './recipe';
import type { JourneySelection, Selection, Side, SideArtifact, Visual } from './result';
import { recipePlan, type JourneyJudgement } from './revisions';
import { comparePixels } from './visual';

// Reads capture directories into parsed sides. Every file is hashed against
// its manifest before it is parsed, and anything missing, changed or
// malformed becomes a reason, never a value.

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

const readVerifiedText = Effect.fnUntraced(function* (
  artifact: Extract<ArtifactResult, { kind: 'available' }>,
) {
  const bytes = yield* nodeIo((signal) => readFile(artifact.absolutePath, { signal }));

  if (sha256(bytes) !== artifact.hash) {
    return {
      kind: 'unavailable',
      reason: 'Artifact changed while being inspected',
    } as const;
  }

  return { kind: 'available', text: bytes.toString('utf8') } as const;
});

const isEvidenceView = Schema.is(evidenceViewSchema);

const parseEvidenceFile = Effect.fnUntraced(function* (kind: EvidenceKind, input: string) {
  const definition = evidenceKinds[kind];
  const malformed: EvidenceView = {
    kind,
    status: 'unavailable',
    reason: `Evidence file is malformed or not schema version ${definition.schemaVersion}`,
  };
  const file = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(definition.file), {
    onExcessProperty: 'error',
  })(input).pipe(
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
    } else if (entry.schemaVersion !== evidenceKinds[entry.kind].schemaVersion) {
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
  return [...prefix.split('/'), ...artifactPath.split('/')].map(encodeURIComponent).join('/');
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
  const side = unavailableSide(reason);
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
        item.kind === 'unavailable' ? [`${item.artifact.id}: ${item.reason}`] : [],
      ),
    ],
  } satisfies Side;
});

export const inspectSide = Effect.fn('inspectSide')(function* ({
  directory,
  prefix,
  evaluatedAt,
  expected,
}: InspectSideOptions) {
  yield* Schema.decodeUnknownEffect(timestamp)(evaluatedAt);

  if (directory === null) {
    return unavailableSide('No capture directory supplied');
  }

  if (!safeRelativePath(prefix)) {
    return unavailableSide('Unsafe evidence URL prefix');
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
      return unavailableSide(`Capture manifest unavailable: ${manifestArtifact.reason}`);
    }

    const manifestText = yield* readVerifiedText(manifestArtifact);

    if (manifestText.kind === 'unavailable') {
      return unavailableSide(manifestText.reason);
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
      return unavailableSide(parsed.reason);
    }

    const capture = parsed.capture;
    const reasons: string[] = [];

    if (expected !== undefined && expected.sourceHash !== capture.source.sha256) {
      reasons.push('Source snapshot does not match the selected sourceHash');
    }

    const inspected = yield* Effect.forEach(capture.artifacts, (artifact) =>
      inspectArtifact(root, artifact),
    );

    const byId = new Map(inspected.map((item) => [item.artifact.id, item]));
    const byPath = new Map(inspected.map((item) => [item.artifact.path, item]));

    const artifacts = inspected.map((item): SideArtifact => {
      if (item.kind === 'unavailable') {
        reasons.push(`${item.artifact.id}: ${item.reason}`);
      }

      return describeArtifact(item, prefix);
    });

    // A failed capture stops before writing these; its failure is the reason.
    for (const id of capture.execution.kind === 'failed' ? [] : requiredArtifacts) {
      if (!byId.has(id)) {
        reasons.push(`Required artifact is missing: ${id}`);
      }
    }

    const recipeArtifact = byId.get('recipe');
    let recipe: Recipe | null = null;

    if (recipeArtifact?.kind === 'available' && recipeArtifact.hash !== capture.recipe.sha256) {
      reasons.push('Recipe artifact bytes do not match the protected recipe SHA-256');
    }

    if (recipeArtifact?.kind === 'available' && recipeArtifact.hash === capture.recipe.sha256) {
      const saved = yield* readVerifiedText(recipeArtifact);

      if (saved.kind === 'available') {
        recipe = yield* parseRecipe(saved.text).pipe(
          Effect.catchTag('SchemaError', () => Effect.succeed(null)),
        );
      }

      if (recipe === null || recipe.id !== capture.recipe.id) {
        reasons.push('Protected recipe is malformed or its identity does not match the capture');
      }
    }

    reasons.push(...captureProblems(capture, evaluatedAt, recipe));

    for (const file of capture.source.files) {
      const artifact = byPath.get(`source/${file.path}`);

      if (!safeRelativePath(file.path)) {
        reasons.push(`Unsafe source file path: ${file.path}`);
      } else if (artifact === undefined) {
        reasons.push(`Source file artifact is missing: source/${file.path}`);
      } else if (artifact.kind === 'available' && artifact.hash !== file.sha256) {
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

    const screenshotArtifact = artifacts.find((artifact) => artifact.id === 'screenshot');
    const screenshot =
      screenshotArtifact?.integrity === 'verified' ? screenshotArtifact.path : null;
    const captured = { manifest: capture, sha256: manifestArtifact.hash };
    const errors =
      observations?.browserErrors.map(
        (error) => `Browser error: ${error.trim() === '' ? '(empty message)' : error.trim()}`,
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
        evidence: recipe === null ? [] : yield* evidenceViews(capture, recipe, byPath),
        screenshot,
        checks,
        ...evidence,
      } satisfies Side;
    }

    if (reasons.length === 0 && observations !== null && recipe !== null && screenshot !== null) {
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

      return { ...side, checks: previewChecks(side) } satisfies Side;
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
      Effect.succeed(unavailableSide(`Capture evidence could not be read (${error.code})`)),
    ),
  );
});

function noVisual(reason: string): { visual: Visual; diff: null } {
  return { visual: { kind: 'unavailable', reason }, diff: null };
}

const loadScreenshot = Effect.fnUntraced(function* (
  directory: string,
  side: Extract<Side, { execution: 'complete' }>,
  label: string,
) {
  const artifact = side.capture.manifest.artifacts.find((item) => item.id === 'screenshot');

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

    const after = yield* loadScreenshot(candidateDirectory, candidate, 'Candidate');

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
  judge = () => ({ kind: 'not-compared' }),
}: {
  baseDirectory: string | null;
  candidateDirectory: string;
  evaluatedAt: string;
  mode?: Mode;
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
    selection === undefined ? 'visual-diff.png' : `${selection.directory}/visual-diff.png`;
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
    ...(selection?.generated === undefined ? {} : { generatedJourney: selection.generated }),
    judgement: candidate.recipe === null ? { kind: 'not-compared' } : judge(candidate.recipe.name),
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
  const plan = recipePlan(selection.recipes, notComparedReason);
  const inspected = yield* Effect.forEach(selection.journeys, (journey) =>
    inspectJourney({
      judge: plan.judge,
      baseDirectory:
        selection.mode === 'preview' ? null : path.join(root, journey.directory, 'base'),
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
      recipe: plan.scope,
      removedJourneys: selection.mode === 'preview' ? [] : removedJourneys(plan.removed),
    }),
    visualDiffs: inspected.flatMap((item) => (item.visualDiff === null ? [] : [item.visualDiff])),
  };
});
