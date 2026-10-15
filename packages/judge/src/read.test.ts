import { Effect, Schema } from 'effect';
import { readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { sourceSchema } from './capture';
import type { EvidenceValue } from './evidence';
import { json, sha256 } from './hash';
import { encodeRgbPng } from './png';
import { inspectJourney } from './read';
import type { Recipe } from './recipe';
import { comparisonSchema, journeySchema, type JourneySelection } from './result';
import {
  allowsTwo,
  evaluatedAt,
  inspect,
  judgedSides,
  projectJourney,
  recipe,
  removeTemporaryDirectories,
  replaceArtifact,
  requestCheck,
  saveManifest,
  selectedComparison,
  single,
  syntheticBundle,
  syntheticObservations,
  withPlaywright,
} from './testing';

afterEach(removeTemporaryDirectories);

function inspectBoth(baseDirectory: string | null, candidateDirectory: string) {
  return Effect.runPromise(inspectJourney({ baseDirectory, candidateDirectory, evaluatedAt }));
}

test('derives a regression from verified request observations despite unchanged image bytes and raw PASS text', async () => {
  const base = await syntheticBundle();
  const candidate = await syntheticBundle({ count: 4 });

  const { journey: result } = await inspectBoth(base.directory, candidate.directory);

  expect(result.base.checks[0]).toMatchObject({ outcome: 'passed', actual: 1 });

  expect(result.candidate.checks[0]).toMatchObject({
    outcome: 'failed',
    actual: 4,
  });

  expect(result.comparison).toMatchObject({
    kind: 'available',
    requestDifference: 3,
    visual: { kind: 'identical', width: 4, height: 4 },
  });

  expect(result.conclusion.kind).toBe('regression');

  expect(result.candidate.screenshot).toBe('candidate/images/after%20%231.png');

  expect(
    result.base.artifacts.find((artifact) => artifact.id === 'arbitrary-source-id-1'),
  ).toMatchObject({
    integrity: 'verified',
    path: 'base/source/ui/%23%20details.ts',
  });

  expect(Schema.decodeUnknownSync(journeySchema)(JSON.parse(json(result)))).toEqual(result);
});

test('records changed pixels as a located observation with a difference image while the named check still passes', async () => {
  const changed = new Uint8Array(4 * 4 * 3).fill(255);
  changed.set([0, 0, 0], (2 * 4 + 1) * 3);
  const base = await syntheticBundle();
  const candidate = await syntheticBundle({
    image: encodeRgbPng(4, 4, changed),
  });

  const { journey, visualDiff } = await inspectBoth(base.directory, candidate.directory);

  expect(journey.conclusion.kind).toBe('no-regression');
  expect(journey.comparison).toMatchObject({
    kind: 'available',
    requestDifference: 0,
    visual: {
      kind: 'changed',
      differingPixels: 1,
      changedPixels: 1,
      regionCount: 1,
      regions: [{ x: 1, y: 2, width: 1, height: 1, changedPixels: 1 }],
      diff: { path: 'visual-diff.png' },
    },
  });

  if (journey.comparison.kind !== 'available' || journey.comparison.visual.kind !== 'changed') {
    throw new Error('Expected a changed pixel observation');
  }

  const diff = journey.comparison.visual.diff;

  expect(visualDiff?.path).toBe(diff.path);
  expect(sha256(visualDiff?.bytes ?? new Uint8Array())).toBe(diff.sha256);
});

test('writes no difference image when changed screenshots belong to captures that cannot be compared', async () => {
  const changed = new Uint8Array(4 * 4 * 3).fill(255);
  changed.set([0, 0, 0], 0);
  const base = await syntheticBundle();
  const candidate = await syntheticBundle({
    contract: { ...recipe, maxAgeMs: recipe.maxAgeMs + 1 },
    image: encodeRgbPng(4, 4, changed),
  });

  const { journey: result, visualDiff } = await inspectBoth(base.directory, candidate.directory);

  expect(result.comparison).toEqual({
    kind: 'unavailable',
    reasons: ['Capture recipes differ'],
  });
  expect(visualDiff).toBeNull();
});

test('identical but undecodable screenshots leave the pixel observation unavailable instead of identical', async () => {
  const base = await syntheticBundle({ image: 'synthetic image bytes' });
  const candidate = await syntheticBundle({ image: 'synthetic image bytes' });

  const { journey: result, visualDiff } = await inspectBoth(base.directory, candidate.directory);

  expect(result.comparison).toMatchObject({
    kind: 'available',
    visual: {
      kind: 'unavailable',
      reason: 'Base screenshot: Not a PNG file',
    },
  });
  expect(visualDiff).toBeNull();
  expect(result.conclusion.kind).toBe('no-regression');
});

test('evaluates a project-defined POST expectation without an items recipe in the comparator', async () => {
  const contract = {
    ...recipe,
    id: 'checkout-submit',
    checks: [
      {
        ...requestCheck,
        method: 'POST',
        path: '/orders',
        expectedCount: 2,
      },
    ],
  };
  const contractText = json(contract);
  const bundle = await syntheticBundle({
    observations: {
      ...syntheticObservations(2),
      requests: syntheticObservations(2).requests.map((request) => ({
        ...request,
        method: 'POST',
        path: '/orders',
      })),
    },
  });

  await writeFile(path.join(bundle.directory, 'recipe.json'), contractText);
  await saveManifest(bundle.directory, {
    ...bundle.capture,
    recipe: { id: contract.id, sha256: sha256(contractText) },
    artifacts: bundle.capture.artifacts.map((artifact) =>
      artifact.id === 'recipe' ? { ...artifact, sha256: sha256(contractText) } : artifact,
    ),
  });

  expect((await inspect(bundle.directory)).checks[0]).toMatchObject({
    outcome: 'passed',
    actual: 2,
  });
});

test('counts only matching GET requests and requires their status to be 200', async () => {
  const observations = syntheticObservations();

  const otherRequests = [
    {
      method: 'POST',
      origin: 'application',
      path: '/api/items',
      status: 500,
      startedAt: observations.window.startedAt,
    },
    {
      method: 'GET',
      origin: 'application',
      path: '/other',
      status: 500,
      startedAt: observations.window.startedAt,
    },
  ] as const;

  const passing = await syntheticBundle({
    observations: {
      ...observations,
      requests: [...observations.requests, ...otherRequests],
    },
  });

  const failed = await syntheticBundle({
    observations: {
      ...observations,
      requests: observations.requests.map((request) => ({
        ...request,
        status: 503,
      })),
    },
  });

  expect((await inspect(passing.directory)).checks[0]).toMatchObject({
    outcome: 'passed',
    actual: 1,
  });

  expect((await inspect(failed.directory)).checks[0]).toMatchObject({
    outcome: 'failed',
    actual: 1,
  });
});

test('matches a protected request origin without conflating the same path on another service', async () => {
  const origin = 'https://api.example.test';
  const observations = syntheticObservations();
  const requests = [
    ...observations.requests,
    ...observations.requests.map((request) => ({
      ...request,
      origin,
      status: 202,
    })),
  ];
  for (const definition of [requestCheck, { ...requestCheck, origin, status: 202 }]) {
    const bundle = await syntheticBundle({
      contract: { ...recipe, allowedOrigins: [origin], checks: [definition] },
      observations: { ...observations, requests },
    });
    const side = await inspect(bundle.directory);
    expect(side.checks[0]).toMatchObject({
      outcome: 'passed',
      actual: 1,
    });
  }

  const unconfigured = await syntheticBundle({
    observations: { ...observations, requests },
  });
  const [check] = (await inspect(unconfigured.directory)).checks;
  expect(check?.outcome).toBe('unknown');
  expect(check?.detail).toContain('outside the protected recipe');
});

test('keeps browser errors as unresolved evidence without inventing another check', async () => {
  const bundle = await syntheticBundle({
    observations: {
      ...syntheticObservations(),
      browserErrors: ['Synthetic page error'],
    },
  });

  const side = await inspect(bundle.directory);

  expect(side.checks[0]?.outcome).toBe('passed');

  expect(side.unresolved).toContain('Browser error: Synthetic page error');
});

function errorsBundle(coverage: EvidenceValue<'browser-errors'>['coverage']) {
  return syntheticBundle({
    observations: {
      ...syntheticObservations(),
      browserErrors: ['Synthetic page error'],
    },
    browserErrors: {
      steps: 1,
      coverage,
      entries: [
        {
          source: 'page',
          text: 'Synthetic page error',
          step: 0,
          after: '2026-09-23T11:59:54.000Z',
          seenAt: '2026-09-23T11:59:54.300Z',
        },
      ],
    },
  });
}

test('leaves browser errors out of unresolved when complete browser-errors evidence lists them', async () => {
  const side = await inspect((await errorsBundle({ kind: 'complete' })).directory);

  expect(side.execution).toBe('complete');
  expect(side.unresolved).toEqual([]);
});

test('keeps browser errors unresolved when the browser-errors evidence is incomplete', async () => {
  const side = await inspect(
    (
      await errorsBundle({
        kind: 'incomplete',
        reason: 'Synthetic buffer replacement',
      })
    ).directory,
  );

  expect(side.unresolved).toContain('Browser error: Synthetic page error');
});

test('serializes empty and newline-terminated browser errors without losing their original text', async () => {
  const browserErrors = ['', 'Synthetic page error\n'];

  const bundle = await syntheticBundle({
    observations: { ...syntheticObservations(), browserErrors },
  });

  const { journey: result } = await inspectBoth(null, bundle.directory);

  expect(result.candidate.checks[0]?.outcome).toBe('passed');

  expect(result.candidate).toMatchObject({
    execution: 'complete',
    observations: { browserErrors },
  });

  const decoded = Schema.decodeUnknownSync(Schema.fromJsonString(comparisonSchema))(
    json(single(result)),
  );

  expect(decoded.journeys[0].candidate).toMatchObject({
    execution: 'complete',
    observations: { browserErrors },
  });

  expect(decoded.journeys[0].candidate.unresolved).toHaveLength(2);
});

test.each([
  [1, 'passed', 'unavailable'],
  [4, 'failed', 'check-failed'],
] as const)(
  'keeps the independent candidate check with a missing baseline (%i requests)',
  async (count, outcome, conclusion) => {
    const candidate = await syntheticBundle({ count });

    const { journey: result } = await inspectBoth(null, candidate.directory);

    expect(result.candidate.checks[0]?.outcome).toBe(outcome);

    expect(result.base.checks[0]?.outcome).toBe('unknown');

    expect(result.comparison.kind).toBe('unavailable');

    expect(result.conclusion.kind).toBe(conclusion);

    expect(result.conclusion.text).toContain('The revisions were not compared');
  },
);

test('marks a schema version 3 capture unavailable with the reason instead of reading or dropping it', async () => {
  const base = await syntheticBundle();
  const candidate = await syntheticBundle();
  const legacy: Record<string, unknown> = {
    ...base.capture,
    schemaVersion: 3,
    source: { ...base.capture.source, revision: 'worktree' },
  };
  delete legacy.observed;

  await saveManifest(base.directory, legacy);

  const side = await inspect(base.directory);

  expect(side.execution).toBe('unavailable');
  expect(side.checks[0]?.detail).toContain('Capture manifest schema version 3 is unsupported');

  const { journey } = await inspectBoth(base.directory, candidate.directory);

  expect(journey.comparison).toMatchObject({
    kind: 'unavailable',
  });
  expect(json(journey.comparison)).toContain(
    'Base unavailable: Capture manifest schema version 3 is unsupported',
  );
  expect(journey.candidate.checks[0]?.outcome).toBe('passed');
});

test('tells the reader to update Observed for a newer capture schema instead of recapturing', async () => {
  const bundle = await syntheticBundle();

  await saveManifest(bundle.directory, { ...bundle.capture, schemaVersion: 6 });

  const side = await inspect(bundle.directory);

  expect(side.execution).toBe('unavailable');
  expect(side.checks[0]?.detail).toContain(
    'Capture manifest schema version 6 is unsupported. It was written by a newer Observed',
  );
  expect(side.checks[0]?.detail).toContain('Update Observed.');
});

test.each([
  'recipe',
  'requests',
  'errors',
  'transcript',
  'screenshot',
  'observations',
  'arbitrary-source-id-1',
])('requires the %s artifact for any pass', async (id) => {
  const bundle = await syntheticBundle();

  await saveManifest(bundle.directory, {
    ...bundle.capture,
    artifacts: bundle.capture.artifacts.filter((artifact) => artifact.id !== id),
  });

  const side = await inspect(bundle.directory);

  expect(side.checks[0]?.outcome).toBe('unknown');

  expect(side.execution).toBe('unavailable');

  expect(side.checks[0]?.detail).toContain('missing');
});

test('checks all supplied artifacts rather than only those used by the named check', async () => {
  const bundle = await syntheticBundle();

  await writeFile(path.join(bundle.directory, 'requests.json'), 'corrupted raw request evidence');

  const side = await inspect(bundle.directory);

  expect(side.checks[0]?.outcome).toBe('unknown');

  const requests = side.artifacts.find((artifact) => artifact.id === 'requests');

  expect(requests?.integrity).toBe('unavailable');
  expect(requests).not.toHaveProperty('path');

  expect(side.checks[0]?.detail).toContain('SHA-256 mismatch');
});

test('requires protected recipe bytes even when the artifact digest was updated', async () => {
  const bundle = await syntheticBundle();

  await replaceArtifact(
    bundle,
    'recipe',
    json({ ...recipe, checks: [{ ...requestCheck, expectedCount: 4 }] }),
  );

  const side = await inspect(bundle.directory);

  expect(side.checks[0]?.outcome).toBe('unknown');

  expect(side.checks[0]?.detail).toContain('protected recipe');
});

test.each(['source digest', 'source file digest', 'entry absent'] as const)(
  'rejects inconsistent %s identities',
  async (problem) => {
    const bundle = await syntheticBundle();
    let source = bundle.capture.source;

    if (problem === 'source digest') {
      source = { ...source, sha256: sha256('a different snapshot') };
    }

    if (problem === 'source file digest') {
      const files = source.files.map((file) => ({
        ...file,
        sha256: sha256('different file bytes'),
      }));

      source = Schema.decodeUnknownSync(sourceSchema)({
        ...source,
        files,
        sha256: sha256(json({ entry: source.entry, files })),
      });
    }

    if (problem === 'entry absent') {
      const entry = 'absent.ts';

      source = {
        ...source,
        entry,
        sha256: sha256(json({ entry, files: source.files })),
      };
    }

    await saveManifest(bundle.directory, { ...bundle.capture, source });

    const side = await inspect(bundle.directory);

    expect(side.checks[0]?.outcome).toBe('unknown');

    expect(side.checks[0]?.detail).toContain('Source');
  },
);

test('hashes source identity in sorted path order regardless of manifest file order', async () => {
  const bundle = await syntheticBundle();

  await saveManifest(bundle.directory, {
    ...bundle.capture,
    source: {
      ...bundle.capture.source,
      files: [...bundle.capture.source.files].reverse(),
    },
  });

  expect((await inspect(bundle.directory)).checks[0]?.outcome).toBe('passed');
});

test.each(['manifestHash', 'sourceHash'] as const)(
  'rejects selection %s mismatch',
  async (field) => {
    const bundle = await syntheticBundle();

    const selection: JourneySelection = {
      directory: 'journey-1',
      base: null,
      candidate: {
        manifestHash: sha256(await readFile(path.join(bundle.directory, 'capture.json'))),
        sourceHash: bundle.capture.source.sha256,
        [field]: sha256('a different selection'),
      },
    };

    const { journey: result } = await Effect.runPromise(
      inspectJourney({
        baseDirectory: null,
        candidateDirectory: bundle.directory,
        evaluatedAt,
        selection,
      }),
    );

    expect(result.candidate.checks[0]?.outcome).toBe('unknown');

    expect(result.candidate.execution).toBe('unavailable');

    expect(result.comparison.kind).toBe('unavailable');
  },
);

test.each(['failed', 'conditions', 'recipe'] as const)(
  'rejects a capture with unavailable %s prerequisites',
  async (problem) => {
    const bundle = await syntheticBundle();

    const changes = {
      failed: {
        execution: {
          kind: 'failed',
          category: 'timeout',
          reason: 'Synthetic timeout',
        },
      },
      conditions: {
        conditions: {
          kind: 'unavailable',
          reason: 'Synthetic missing conditions',
        },
      },
      recipe: {
        recipe: {
          ...bundle.capture.recipe,
          sha256: sha256('unsupported recipe'),
        },
      },
    };

    await saveManifest(bundle.directory, {
      ...bundle.capture,
      ...changes[problem],
    });

    const side = await inspect(bundle.directory);

    expect(side.checks[0]?.outcome).toBe('unknown');

    expect(side.execution).toBe(problem === 'failed' ? 'capture-failed' : 'unavailable');
  },
);

test('accepts the maximum age boundary and rejects stale or future captures', async () => {
  const bundle = await syntheticBundle();

  const lastValidTime = new Date(
    Date.parse(bundle.capture.finishedAt) + recipe.maxAgeMs,
  ).toISOString();

  const staleTime = new Date(Date.parse(lastValidTime) + 1).toISOString();

  expect((await inspect(bundle.directory, lastValidTime)).checks[0]?.outcome).toBe('passed');

  expect((await inspect(bundle.directory, staleTime)).checks[0]?.detail).toContain('stale');

  expect((await inspect(bundle.directory, bundle.capture.startedAt)).checks[0]?.detail).toContain(
    'future',
  );
});

test.each(['invalid JSON', 'wrong shape', 'inverted window', 'out-of-window request'] as const)(
  'rejects observations with %s even when the digest matches',
  async (problem) => {
    const bundle = await syntheticBundle();
    const observations = syntheticObservations();

    const malformed = {
      'invalid JSON': '{',
      'wrong shape': json({
        ...observations,
        requests: [{ method: 'GET', path: '/api/items' }],
      }),
      'inverted window': json({
        ...observations,
        window: {
          startedAt: observations.window.finishedAt,
          finishedAt: observations.window.startedAt,
        },
      }),
      'out-of-window request': json({
        ...observations,
        requests: observations.requests.map((request) => ({
          ...request,
          startedAt: bundle.capture.startedAt,
        })),
      }),
    };

    await replaceArtifact(bundle, 'observations', malformed[problem]);

    const side = await inspect(bundle.directory);

    expect(side.checks[0]?.outcome).toBe('unknown');

    expect(side).not.toHaveProperty('observations');
  },
);

test.each(['../outside.png', '/absolute.png', 'images\\after.png', 'images/../after.png'])(
  'does not link unsafe artifact path %s',
  async (unsafePath) => {
    const bundle = await syntheticBundle();

    await saveManifest(bundle.directory, {
      ...bundle.capture,
      artifacts: bundle.capture.artifacts.map((artifact) =>
        artifact.id === 'screenshot' ? { ...artifact, path: unsafePath } : artifact,
      ),
    });

    const side = await inspect(bundle.directory);

    expect(side.checks[0]?.outcome).toBe('unknown');

    expect(side.screenshot).toBeNull();

    const screenshot = side.artifacts.find((artifact) => artifact.id === 'screenshot');

    expect(screenshot?.integrity).toBe('unavailable');
    expect(screenshot).not.toHaveProperty('path');
  },
);

test('rejects symlink artifacts even when their target has the expected bytes', async () => {
  const bundle = await syntheticBundle();
  const outside = await syntheticBundle();
  const image = 'images/after #1.png';

  await rm(path.join(bundle.directory, image));

  await symlink(path.join(outside.directory, image), path.join(bundle.directory, image));

  const side = await inspect(bundle.directory);

  expect(side.checks[0]?.outcome).toBe('unknown');

  expect(side.checks[0]?.detail).toContain('Symlink');

  expect(side.screenshot).toBeNull();
});

test('rejects missing files, malformed manifests, and absent conditions instead of manufacturing empty success', async () => {
  const bundle = await syntheticBundle();

  await rm(path.join(bundle.directory, 'errors.json'));

  expect((await inspect(bundle.directory)).checks[0]?.detail).toContain('ENOENT');

  await writeFile(path.join(bundle.directory, 'capture.json'), '{');

  expect((await inspect(bundle.directory)).checks[0]?.detail).toContain('malformed');

  await saveManifest(bundle.directory, {
    ...bundle.capture,
    conditions: undefined,
  });

  expect((await inspect(bundle.directory)).checks[0]?.outcome).toBe('unknown');

  await rm(path.join(bundle.directory, 'capture.json'));

  expect((await inspect(bundle.directory)).checks[0]?.detail).toContain('ENOENT');
});

const savedText = {
  kind: 'text',
  id: 'saved',
  name: 'Saved status',
  scope: 'After saving',
  selector: '#status',
  expectedText: 'Saved',
} as const;

const twoChecks: Recipe = {
  ...recipe,
  checks: [requestCheck, savedText],
  collectors: [{ kind: 'text', selectors: ['#status'] }],
};

function statusText(value: string | null, count = 1) {
  return { elements: [{ selector: '#status', count, value }] };
}

test.each(['base', 'candidate', 'both'] as const)(
  'unsupported collector on %s cannot establish no regression',
  async (side) => {
    const base = await syntheticBundle({
      contract: twoChecks,
      text: statusText('Saved'),
    });
    const candidate = await syntheticBundle({
      contract: twoChecks,
      text: statusText('Saved'),
    });
    const bundles = side === 'both' ? [base, candidate] : [side === 'base' ? base : candidate];
    for (const bundle of bundles) {
      await saveManifest(bundle.directory, {
        ...bundle.capture,
        evidence: bundle.capture.evidence.map((entry) =>
          entry.kind === 'text' ? { ...entry, kind: 'future-collector' } : entry,
        ),
      });
    }

    const { journey } = await inspectBoth(base.directory, candidate.directory);
    expect(journey.conclusion.kind).toBe('unavailable');
    expect(journey.comparison).toMatchObject({ kind: 'unavailable' });
    expect(journey.checks.find((check) => check.id === requestCheck.id)?.verdict).toBe('passed');
  },
);

test('evidence whose file changed after capture leaves its check unknown, not passed', async () => {
  const bundle = await syntheticBundle({
    contract: twoChecks,
    text: statusText('Saved'),
  });

  await writeFile(
    path.join(bundle.directory, 'evidence/text.json'),
    json({ kind: 'text', schemaVersion: 1, value: statusText('Saved', 2) }),
  );

  const side = await inspect(bundle.directory);

  expect(side.execution).toBe('unavailable');
  expect(side.checks.map((check) => check.outcome)).toEqual(['unknown', 'unknown']);
});

test('changed captured text alone is no regression even when the screenshots are identical', async () => {
  const contract: Recipe = {
    ...recipe,
    collectors: [...recipe.collectors, { kind: 'text', selectors: ['#output'] }],
  };
  const before = await syntheticBundle({
    contract,
    text: { elements: [{ selector: '#output', count: 1, value: '$120.00' }] },
  });
  const after = await syntheticBundle({
    contract,
    text: { elements: [{ selector: '#output', count: 1, value: '$12.00' }] },
  });
  const { journey } = await inspectBoth(before.directory, after.directory);

  expect(journey.conclusion.kind).toBe('no-regression');
});

test('a raised expectation is judged by the base, and the proposal sets no verdict', async () => {
  // A duplicate request ships with expectedCount raised from 1 to 2.
  const bundles = await judgedSides({
    captured: [allowsTwo],
    baseCount: 1,
    candidateCount: 2,
  });
  const result = await selectedComparison(bundles, {
    base: {
      kind: 'read',
      commit: 'c'.repeat(40),
      sha256: 'd'.repeat(64),
      journeys: [projectJourney([requestCheck])],
    },
    candidate: [projectJourney([allowsTwo])],
  });
  const [journey] = result.journeys;

  expect(journey.checks).toMatchObject([
    {
      id: requestCheck.id,
      verdict: 'regression',
      expectation: 'Exactly 1 GET /api/items request(s) with status 200.',
      recipe: {
        change: 'altered',
        proposed: {
          expectation: 'Exactly 2 GET /api/items request(s) with status 200.',
          outcome: 'passed',
        },
      },
    },
  ]);
  expect(result.conclusion.kind).toBe('regression');
  expect(result.conclusion.text).toContain(
    "The candidate's proposed version passed and sets no verdict.",
  );
  expect(journey.base.checks).toEqual([
    expect.objectContaining({ outcome: 'passed', actual: 1 }) as unknown,
  ]);
  expect(journey.comparison).toMatchObject({ kind: 'available' });
  expect(journey.comparison.kind === 'available' && journey.comparison.basis).toContain(
    "The base's observed.json defines this journey differently.",
  );
  expect(result.recipe).toMatchObject({
    kind: 'changed',
    differences: [
      {
        check: requestCheck.id,
        change: 'altered',
        fields: [{ field: 'expectedCount', base: 1, candidate: 2 }],
      },
    ],
  });

  // Without the base file, the captured definition judges both sides.
  const uncompared = await selectedComparison(bundles, undefined);

  expect(uncompared.conclusion.kind).toBe('no-regression');
  expect(uncompared.recipe).toMatchObject({ kind: 'unavailable' });
});

test('a removed journey leaves its checks unknown and the run unavailable', async () => {
  const bundles = await judgedSides({
    captured: [requestCheck],
    baseCount: 1,
    candidateCount: 1,
  });
  const result = await selectedComparison(bundles, {
    base: {
      kind: 'read',
      commit: 'c'.repeat(40),
      sha256: 'd'.repeat(64),
      journeys: [
        projectJourney([requestCheck]),
        projectJourney([requestCheck], { name: 'Reload items' }),
      ],
    },
    candidate: [projectJourney([requestCheck])],
  });

  expect(result.removedJourneys).toEqual([
    {
      journey: 'Reload items',
      checks: [
        expect.objectContaining({
          id: requestCheck.id,
          verdict: 'unknown',
          recipe: { change: 'removed' },
        }) as unknown,
      ],
    },
  ]);
  expect(result.journeys[0].checks).toEqual([
    expect.objectContaining({ verdict: 'passed' }) as unknown,
  ]);
  expect(result.summary).toEqual({ passed: 1, total: 2 });
  expect(result.conclusion.kind).toBe('unavailable');
  expect(result.conclusion.text).toContain(
    'Reload items: this change removes the journey, so no capture ran its checks.',
  );
});

test('a removed journey that ran Playwright leaves an unknown imported run', async () => {
  const bundles = await judgedSides({
    captured: [requestCheck],
    baseCount: 1,
    candidateCount: 1,
  });
  const result = await selectedComparison(bundles, {
    base: {
      kind: 'read',
      commit: 'c'.repeat(40),
      sha256: 'd'.repeat(64),
      journeys: [
        projectJourney([requestCheck]),
        projectJourney([], {
          name: 'Run end-to-end tests',
          collectors: withPlaywright.collectors,
        }),
      ],
    },
    candidate: [projectJourney([requestCheck])],
  });

  expect(result.removedJourneys).toMatchObject([
    {
      journey: 'Run end-to-end tests',
      checks: [{ id: 'playwright-run', verdict: 'unknown' }],
    },
  ]);
  expect(result.conclusion.kind).toBe('unavailable');
});
