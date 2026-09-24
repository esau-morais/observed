import { DateTime, Effect, Schema } from 'effect';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  parseCapture,
  parseObservations,
  timestamp,
  type Capture,
  type Observations,
} from './capture/model';
import { json, producer, recipe, recipeHash, sha256 } from './capture/recipe';
import type { Comparison, Selection, Side } from './comparison-model';
import { inspectArtifact, type ArtifactResult } from './evidence';
import { nodeIo } from './node-io';

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

function unknownCheck(detail: string): Side['check'] {
  return {
    id: recipe.check.id,
    name: recipe.check.name,
    authority: 'Executed by Observed',
    scope: recipe.check.scope,
    expectation: `Exactly ${recipe.check.expectedCount} ${recipe.check.method} ${recipe.check.path} request with status 200.`,
    outcome: 'unknown',
    actual: null,
    detail,
  };
}

function unavailable(reason: string): Side {
  return {
    manifest: null,
    manifestHash: null,
    execution: 'unavailable',
    check: unknownCheck(reason),
    observations: null,
    artifacts: [],
    screenshot: null,
    unresolved: [reason],
  };
}

function safeRelativePath(value: string): boolean {
  return (
    !path.isAbsolute(value) &&
    !/[\\:\p{Cc}]/u.test(value) &&
    value.split('/').every((part) => !['', '.', '..'].includes(part))
  );
}

function artifactLink(prefix: string, artifactPath: string): string {
  return [...prefix.split('/'), ...artifactPath.split('/')]
    .map(encodeURIComponent)
    .join('/');
}

function captureProblems(capture: Capture, evaluatedAt: string): string[] {
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

  if (capture.recipe.id !== recipe.id || capture.recipe.sha256 !== recipeHash) {
    reasons.push('Unsupported recipe identity or SHA-256 digest');
  }

  if (
    capture.producer.name !== producer.name ||
    capture.producer.version !== producer.version
  ) {
    reasons.push(
      `Unsupported producer; required ${producer.name} ${producer.version}`,
    );
  }

  const age =
    DateTime.toEpochMillis(DateTime.makeUnsafe(evaluatedAt)) -
    DateTime.toEpochMillis(DateTime.makeUnsafe(capture.finishedAt));

  if (age < 0) {
    reasons.push('Capture timestamp is in the future relative to evaluatedAt');
  } else if (age > recipe.maxAgeMs) {
    reasons.push(`Capture is stale: older than ${recipe.maxAgeMs} ms`);
  }

  const files = capture.source.files
    .map((file) => ({ path: file.path, sha256: file.sha256 }))
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
): string[] {
  const { startedAt, finishedAt } = observations.window;

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
      Effect.catchTag('SchemaError', () =>
        Effect.succeed({ kind: 'invalid' } as const),
      ),
    );

    if (parsed.kind === 'invalid') {
      return unavailable('Capture manifest is malformed or unsupported');
    }

    const capture = parsed.capture;
    const reasons = captureProblems(capture, evaluatedAt);

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

        return {
          id: item.artifact.id,
          path: null,
          description: item.artifact.description,
          integrity: 'unavailable',
          reason: item.reason,
        };
      }

      return {
        id: item.artifact.id,
        path: artifactLink(prefix, item.artifact.path),
        description: item.artifact.description,
        integrity: 'verified',
        reason: null,
      };
    });

    for (const id of requiredArtifacts) {
      if (!byId.has(id)) {
        reasons.push(`Required artifact is missing: ${id}`);
      }
    }

    const recipeArtifact = byId.get('recipe');

    if (
      recipeArtifact?.kind === 'available' &&
      recipeArtifact.hash !== recipeHash
    ) {
      reasons.push(
        'Recipe artifact bytes do not match the protected recipe SHA-256',
      );
    }

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
          reasons.push(...observationProblems(capture, observations));
        }
      }
    }

    let check = unknownCheck(
      reasons.length === 0
        ? 'Verified observations unavailable'
        : reasons.join('; '),
    );

    let execution: Side['execution'] = 'unavailable';

    if (capture.execution.kind === 'failed') {
      execution = 'capture-failed';
    } else if (reasons.length === 0 && observations !== null) {
      execution = 'complete';

      const requests = observations.requests.filter(
        (request) =>
          request.method === recipe.check.method &&
          request.path === recipe.check.path,
      );

      const allSuccessful = requests.every((request) => request.status === 200);

      const statuses =
        requests.length === 0
          ? 'none'
          : requests.map((request) => request.status).join(', ');

      check = {
        ...check,
        outcome:
          requests.length === recipe.check.expectedCount && allSuccessful
            ? 'passed'
            : 'failed',
        actual: requests.length,
        detail: `Observed ${requests.length} matching ${recipe.check.method} ${recipe.check.path} request(s); statuses: ${statuses}.`,
      };
    }

    const screenshot = artifacts.find(
      (artifact) => artifact.id === 'screenshot',
    );

    return {
      manifest: capture,
      manifestHash: manifestArtifact.hash,
      execution,
      check,
      observations: reasons.length === 0 ? observations : null,
      artifacts,
      screenshot: screenshot?.path ?? null,
      unresolved: [
        ...reasons,
        ...(observations?.browserErrors.map(
          (error) =>
            `Browser error: ${error.trim() === '' ? '(empty message)' : error.trim()}`,
        ) ?? []),
      ],
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
  if (side.manifest === null || side.execution !== 'complete') {
    return side;
  }

  const reasons = captureProblems(side.manifest, evaluatedAt);

  if (reasons.length === 0) {
    return side;
  }

  return {
    ...side,
    execution: 'unavailable',
    check: unknownCheck(reasons.join('; ')),
    observations: null,
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
      side.manifest === null ||
      side.manifestHash === null ||
      side.observations === null ||
      side.check.outcome === 'unknown' ||
      side.artifacts.some((artifact) => artifact.integrity !== 'verified')
    ) {
      reasons.push(`${name} unavailable: ${side.check.detail}`);
    }
  }

  if (base.manifest !== null && candidate.manifest !== null) {
    if (base.manifest.application !== candidate.manifest.application) {
      reasons.push('Captures belong to different applications');
    }

    if (!isDeepStrictEqual(base.manifest.recipe, candidate.manifest.recipe)) {
      reasons.push('Capture recipes differ');
    }

    if (
      !isDeepStrictEqual(base.manifest.producer, candidate.manifest.producer)
    ) {
      reasons.push('Capture producers differ');
    }

    if (
      !isDeepStrictEqual(
        base.manifest.conditions,
        candidate.manifest.conditions,
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

export function compareCaptures({
  base: inspectedBase,
  candidate: inspectedCandidate,
  evaluatedAt,
}: {
  base: Side;
  candidate: Side;
  evaluatedAt: string;
}): Comparison {
  const base = sideAt(inspectedBase, evaluatedAt);
  const candidate = sideAt(inspectedCandidate, evaluatedAt);
  const reasons = comparisonProblems(base, candidate);
  const firstReason = reasons[0];

  const common = {
    schemaVersion: 1,
    title: 'Load items request comparison',
    evaluatedAt,
    base,
    candidate,
    limitations: [
      recipe.check.scope,
      'Only the named request count and status check was evaluated. Browser errors remain unresolved evidence.',
      'Screenshot SHA-256 differences show changed bytes, not a visual regression.',
      'Artifact hashes detect changed bytes; they do not establish collector honesty or source causation.',
    ],
  } as const;

  if (firstReason !== undefined) {
    return {
      ...common,
      comparison: {
        kind: 'unavailable',
        reasons: [firstReason, ...reasons.slice(1)],
      },
      conclusion: {
        kind: 'unavailable',
        text: `Revision comparison unavailable. Candidate named request check: ${candidate.check.outcome}.`,
      },
    };
  }

  const regression =
    base.check.outcome === 'passed' && candidate.check.outcome === 'failed';

  const baseScreenshot = base.manifest?.artifacts.find(
    (item) => item.id === 'screenshot',
  );

  const candidateScreenshot = candidate.manifest?.artifacts.find(
    (item) => item.id === 'screenshot',
  );

  const baseCount = base.check.actual;
  const candidateCount = candidate.check.actual;

  if (
    baseCount === null ||
    candidateCount === null ||
    baseScreenshot === undefined ||
    candidateScreenshot === undefined
  ) {
    return {
      ...common,
      comparison: {
        kind: 'unavailable',
        reasons: ['Verified request counts or screenshots unavailable'],
      },
      conclusion: {
        kind: 'unavailable',
        text: 'Required comparison evidence is unavailable.',
      },
    };
  }

  return {
    ...common,
    comparison: {
      kind: 'available',
      basis:
        'Complete, intact captures with the same protected recipe, application, producer, and recorded conditions.',
      requestDifference: candidateCount - baseCount,
      visual:
        baseScreenshot.sha256 === candidateScreenshot.sha256
          ? 'unchanged'
          : 'changed',
    },
    conclusion: {
      kind: regression ? 'regression' : 'no-regression',
      text: regression
        ? `Request regression: ${baseCount} request before, ${candidateCount} after. ${recipe.check.name} requires exactly ${recipe.check.expectedCount} successful ${recipe.check.method} ${recipe.check.path} request. The base passed; the candidate failed.`
        : `No passing-to-failed transition in ${recipe.check.name}. Base: ${base.check.outcome}; candidate: ${candidate.check.outcome}.`,
    },
  };
}

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
      : unavailable(selection.baseIssue);

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
      : unavailable(selection.candidateIssue);

  return compareCaptures({ base, candidate, evaluatedAt });
});
