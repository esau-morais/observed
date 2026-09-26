import { BunServices } from '@effect/platform-bun';
import { Clock, Effect, Schema } from 'effect';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
  sourceSchema,
  type Capture,
  type CaptureArtifact,
  type Observations,
} from '../src/capture/model';
import { json, sha256 } from '../src/encoding';
import type { Recipe } from '../src/capture/recipe';
import {
  fixtureHash,
  observed,
  producer,
  recipe,
} from './support/request-recipe';
import {
  compareCaptures,
  inspectComparison,
  inspectSide,
} from '../src/comparison';
import {
  comparisonSchema,
  type Selection,
  type Visual,
} from '../src/comparison-model';
import { renderComparison } from '../src/comparison-report';
import { exportComparison } from '../src/export';
import { encodeRgbPng } from '../src/png';
import { serveReport } from '../src/view';

const evaluatedAt = '2026-09-23T12:00:00.000Z';
const whitePng = encodeRgbPng(4, 4, new Uint8Array(4 * 4 * 3).fill(255));
const pixelsNotInspected: Visual = {
  kind: 'unavailable',
  reason: 'Synthetic sides without screenshot pixels',
};
const directories: string[] = [];

function syntheticObservations(count = 1): Observations {
  return {
    schemaVersion: 2,
    requests: Array.from({ length: count }, () => ({
      method: 'GET',
      origin: 'application',
      path: '/api/items',
      status: 200,
      startedAt: '2026-09-23T11:59:55.000Z',
    })),
    browserErrors: [],
    window: {
      startedAt: '2026-09-23T11:59:54.000Z',
      finishedAt: '2026-09-23T11:59:56.000Z',
    },
  };
}

async function saveManifest(
  directory: string,
  capture: unknown,
): Promise<void> {
  await writeFile(path.join(directory, 'capture.json'), json(capture));
}

async function syntheticBundle(
  options: {
    count?: number;
    image?: string | Uint8Array;
    observations?: Observations;
    contract?: Recipe;
  } = {},
) {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'observed-comparison-test-'),
  );

  directories.push(directory);

  const files = [
    {
      path: 'main.ts',
      content: 'Synthetic source fixture, not an application.\n',
    },
    { path: 'ui/# details.ts', content: 'Synthetic secondary source file.\n' },
  ];

  const sourceFiles = files.map((file) => ({
    path: file.path,
    sha256: sha256(file.content),
  }));

  const sourceIdentity = { entry: 'main.ts', files: sourceFiles };
  const artifacts: CaptureArtifact[] = [];
  const contract = options.contract ?? recipe;
  const contractText = json(contract);

  const contents = [
    { id: 'recipe', path: 'recipe.json', text: contractText },
    {
      id: 'requests',
      path: 'requests.json',
      text: '{"synthetic":true,"claim":"PASS"}\n',
    },
    { id: 'errors', path: 'errors.json', text: '[]\n' },
    {
      id: 'transcript',
      path: 'transcript.txt',
      text: 'Synthetic unit fixture, not live browser evidence.\n',
    },
    {
      id: 'screenshot',
      path: 'images/after #1.png',
      text: options.image ?? whitePng,
    },
    {
      id: 'observations',
      path: 'observations.json',
      text: json(options.observations ?? syntheticObservations(options.count)),
    },
    ...files.map((file, index) => ({
      id: `arbitrary-source-id-${index}`,
      path: `source/${file.path}`,
      text: file.content,
    })),
  ];

  for (const content of contents) {
    const destination = path.join(directory, content.path);

    await mkdir(path.dirname(destination), { recursive: true });

    await writeFile(destination, content.text);

    artifacts.push({
      id: content.id,
      path: content.path,
      description: `Synthetic ${content.id} fixture`,
      sha256: sha256(content.text),
    });
  }

  const capture: Capture = {
    schemaVersion: 4,
    kind: 'capture',
    id: path.basename(directory),
    label: 'Synthetic unit fixture',
    application: 'Synthetic application',
    source: Schema.decodeUnknownSync(sourceSchema)({
      kind: 'snapshot',
      sha256: sha256(json(sourceIdentity)),
      revision: {
        kind: 'worktree',
        head: { kind: 'commit', commit: 'b'.repeat(40) },
      },
      ...sourceIdentity,
    }),
    recipe: { id: contract.id, sha256: sha256(contractText) },
    producer,
    observed,
    conditions: {
      kind: 'recorded',
      value: {
        browser: 'Synthetic test browser',
        platform: 'synthetic-platform',
        bun: '1.4.2',
        viewport: recipe.viewport,
        colorScheme: 'light',
        locale: 'en-US',
        timezone: 'UTC',
        inputsHash: fixtureHash,
        dependenciesHash: sha256('synthetic-lockfile'),
      },
    },
    startedAt: '2026-09-23T11:59:50.000Z',
    finishedAt: '2026-09-23T11:59:59.000Z',
    execution: { kind: 'complete' },
    artifacts,
  };

  await saveManifest(directory, capture);

  return { directory, capture };
}

async function replaceArtifact(
  bundle: Awaited<ReturnType<typeof syntheticBundle>>,
  id: string,
  content: string,
): Promise<void> {
  const artifact = bundle.capture.artifacts.find((item) => item.id === id);

  if (artifact === undefined) {
    throw new Error(`Synthetic fixture artifact missing: ${id}`);
  }

  await writeFile(path.join(bundle.directory, artifact.path), content);

  await saveManifest(bundle.directory, {
    ...bundle.capture,
    artifacts: bundle.capture.artifacts.map((item) =>
      item.id === id ? { ...item, sha256: sha256(content) } : item,
    ),
  });
}

function inspect(directory: string | null, at = evaluatedAt) {
  return Effect.runPromise(
    inspectSide({ directory, prefix: 'candidate', evaluatedAt: at }),
  );
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function clockAt(iso: string): Clock.Clock {
  const millis = Date.parse(iso);
  const nanos = BigInt(millis) * 1_000_000n;

  return {
    currentTimeMillisUnsafe: () => millis,
    currentTimeMillis: Effect.succeed(millis),
    currentTimeNanosUnsafe: () => nanos,
    currentTimeNanos: Effect.succeed(nanos),
    monotonicTimeNanosUnsafe: () => nanos,
    monotonicTimeNanos: Effect.succeed(nanos),
    sleep: () => Effect.void,
  };
}

test('the viewer serves the result evaluated at export instead of re-grading capture age when opened later', async () => {
  const base = await syntheticBundle();
  const candidate = await syntheticBundle({ count: 4 });
  const root = await mkdtemp(path.join(tmpdir(), 'observed-view-later-'));
  directories.push(root);
  await mkdir(path.join(root, 'dist/viewer'), { recursive: true });
  await writeFile(
    path.join(root, 'dist/viewer/index.html'),
    '<!doctype html><title>Synthetic viewer asset</title>',
  );

  const exported = await Effect.runPromise(
    exportComparison({
      baseDirectory: base.directory,
      candidateDirectory: candidate.directory,
      directory: path.join(root, 'report'),
      viewerDirectory: path.join(root, 'dist/viewer'),
    }).pipe(
      Effect.provideService(Clock.Clock, clockAt(evaluatedAt)),
      Effect.provide(BunServices.layer),
    ),
  );
  expect(exported.result.conclusion.kind).toBe('regression');

  const served = await Effect.runPromise(
    Effect.gen(function* () {
      const url = yield* serveReport({
        directory: exported.directory,
        port: 0,
      });

      return yield* Effect.promise(async () =>
        (await fetch(new URL('result.json', url))).text(),
      );
    }).pipe(
      Effect.scoped,
      Effect.provideService(Clock.Clock, clockAt('2026-09-25T12:00:00.000Z')),
      Effect.provide(BunServices.layer),
    ),
  );

  expect(
    Schema.decodeUnknownSync(Schema.fromJsonString(comparisonSchema))(served),
  ).toEqual(exported.result);
});

test('derives a regression from verified request observations despite unchanged image bytes and raw PASS text', async () => {
  const base = await syntheticBundle();
  const candidate = await syntheticBundle({ count: 4 });

  const { result } = await Effect.runPromise(
    inspectComparison({
      baseDirectory: base.directory,
      candidateDirectory: candidate.directory,
      evaluatedAt,
    }),
  );

  expect(result.base.check).toMatchObject({ outcome: 'passed', actual: 1 });

  expect(result.candidate.check).toMatchObject({
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
    result.base.artifacts.find(
      (artifact) => artifact.id === 'arbitrary-source-id-1',
    ),
  ).toMatchObject({
    integrity: 'verified',
    path: 'base/source/ui/%23%20details.ts',
  });

  expect(
    Schema.decodeUnknownSync(comparisonSchema)(JSON.parse(json(result))),
  ).toEqual(result);
});

test('rejects saved results whose side state contradicts its evidence', async () => {
  const result = compareCaptures({
    visual: pixelsNotInspected,
    base: await inspect((await syntheticBundle()).directory),
    candidate: await inspect((await syntheticBundle()).directory),
    evaluatedAt,
  });
  const decode = Schema.decodeUnknownExit(comparisonSchema);

  expect(decode(result)._tag).toBe('Success');

  for (const candidate of [
    { ...result.candidate, capture: null },
    { ...result.candidate, execution: 'capture-failed' },
    {
      ...result.candidate,
      artifacts: [
        { id: 'screenshot', description: 'Image', integrity: 'verified' },
      ],
    },
    {
      ...result.candidate,
      artifacts: [
        { id: 'screenshot', description: 'Image', integrity: 'unavailable' },
      ],
    },
  ]) {
    expect(decode({ ...result, candidate })._tag).toBe('Failure');
  }
});

test('exports changed pixels as a located observation with a served difference image while the named check still passes', async () => {
  const changed = new Uint8Array(4 * 4 * 3).fill(255);
  changed.set([0, 0, 0], (2 * 4 + 1) * 3);
  const base = await syntheticBundle();
  const candidate = await syntheticBundle({
    image: encodeRgbPng(4, 4, changed),
  });
  const root = await mkdtemp(path.join(tmpdir(), 'observed-visual-'));
  directories.push(root);
  await mkdir(path.join(root, 'viewer'));
  await writeFile(
    path.join(root, 'viewer/index.html'),
    '<!doctype html><title>Synthetic viewer asset</title>',
  );

  const exported = await Effect.runPromise(
    exportComparison({
      baseDirectory: base.directory,
      candidateDirectory: candidate.directory,
      directory: path.join(root, 'report'),
      viewerDirectory: path.join(root, 'viewer'),
    }).pipe(
      Effect.provideService(Clock.Clock, clockAt(evaluatedAt)),
      Effect.provide(BunServices.layer),
    ),
  );

  expect(exported.result.conclusion.kind).toBe('no-regression');
  expect(exported.result.comparison).toMatchObject({
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

  if (
    exported.result.comparison.kind !== 'available' ||
    exported.result.comparison.visual.kind !== 'changed'
  ) {
    throw new Error('Expected a changed pixel observation');
  }

  const diff = exported.result.comparison.visual.diff;
  const saved = await readFile(path.join(exported.directory, diff.path));
  expect(sha256(saved)).toBe(diff.sha256);
  expect(
    await readFile(path.join(exported.directory, 'report.md'), 'utf8'),
  ).toContain('(<visual-diff.png>)');

  const served = await Effect.runPromise(
    Effect.gen(function* () {
      const url = yield* serveReport({
        directory: exported.directory,
        port: 0,
      });

      return yield* Effect.promise(
        async () =>
          new Uint8Array(
            await (await fetch(new URL(diff.path, url))).arrayBuffer(),
          ),
      );
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  );

  expect(sha256(served)).toBe(diff.sha256);

  await writeFile(
    path.join(exported.directory, diff.path),
    encodeRgbPng(4, 4, changed),
  );

  const tampered = await Effect.runPromise(
    serveReport({ directory: exported.directory, port: 0 }).pipe(
      Effect.flip,
      Effect.scoped,
      Effect.provide(BunServices.layer),
    ),
  );

  expect(tampered.message).toContain('visual-diff.png: SHA-256 mismatch');
});

test('writes no difference image when changed screenshots belong to captures that cannot be compared', async () => {
  const changed = new Uint8Array(4 * 4 * 3).fill(255);
  changed.set([0, 0, 0], 0);
  const base = await syntheticBundle();
  const candidate = await syntheticBundle({
    contract: { ...recipe, maxAgeMs: recipe.maxAgeMs + 1 },
    image: encodeRgbPng(4, 4, changed),
  });

  const { result, visualDiff } = await Effect.runPromise(
    inspectComparison({
      baseDirectory: base.directory,
      candidateDirectory: candidate.directory,
      evaluatedAt,
    }),
  );

  expect(result.comparison).toEqual({
    kind: 'unavailable',
    reasons: ['Capture recipes differ'],
  });
  expect(visualDiff).toBeNull();
});

test('identical but undecodable screenshots leave the pixel observation unavailable instead of identical', async () => {
  const base = await syntheticBundle({ image: 'synthetic image bytes' });
  const candidate = await syntheticBundle({ image: 'synthetic image bytes' });

  const { result, visualDiff } = await Effect.runPromise(
    inspectComparison({
      baseDirectory: base.directory,
      candidateDirectory: candidate.directory,
      evaluatedAt,
    }),
  );

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
    check: {
      ...recipe.check,
      method: 'POST',
      path: '/orders',
      expectedCount: 2,
    },
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
      artifact.id === 'recipe'
        ? { ...artifact, sha256: sha256(contractText) }
        : artifact,
    ),
  });

  expect((await inspect(bundle.directory)).check).toMatchObject({
    outcome: 'passed',
    actual: 2,
  });
});

test.each([0, 2])(
  'fails the named count check for %i requests without inventing a regression from a failing base',
  async (count) => {
    const base = await syntheticBundle({ count: 3 });
    const candidate = await syntheticBundle({ count });

    const result = compareCaptures({
      visual: pixelsNotInspected,
      base: await inspect(base.directory),
      candidate: await inspect(candidate.directory),
      evaluatedAt,
    });

    expect(result.candidate.check).toMatchObject({
      outcome: 'failed',
      actual: count,
    });

    expect(result.comparison.kind).toBe('available');

    expect(result.conclusion.kind).toBe('check-failed');

    expect(result.conclusion.text).toContain(
      'Base also failed, so this is not a regression',
    );
  },
);

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
  ];

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

  expect((await inspect(passing.directory)).check).toMatchObject({
    outcome: 'passed',
    actual: 1,
  });

  expect((await inspect(failed.directory)).check).toMatchObject({
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
  if (recipe.check?.kind !== 'request-count') {
    throw new Error('Request recipe expected');
  }

  for (const definition of [
    recipe.check,
    { ...recipe.check, origin, status: 202 },
  ]) {
    const bundle = await syntheticBundle({
      contract: { ...recipe, allowedOrigins: [origin], check: definition },
      observations: { ...observations, requests },
    });
    const side = await inspect(bundle.directory);
    expect(side.check).toMatchObject({
      outcome: 'passed',
      actual: 1,
    });
    const report = renderComparison(
      compareCaptures({
        visual: pixelsNotInspected,
        base: side,
        candidate: side,
        evaluatedAt,
      }),
    );
    expect(report).toContain('| GET | /api/items | 200 |');
    expect(report).toContain(
      '| GET | https://api\\.example\\.test/api/items | 202 |',
    );
  }

  const unconfigured = await syntheticBundle({
    observations: { ...observations, requests },
  });
  const check = (await inspect(unconfigured.directory)).check;
  expect(check.outcome).toBe('unknown');
  expect(check.detail).toContain('outside the protected recipe');
});

test('keeps browser errors as unresolved evidence without inventing another check', async () => {
  const bundle = await syntheticBundle({
    observations: {
      ...syntheticObservations(),
      browserErrors: ['Synthetic page error'],
    },
  });

  const side = await inspect(bundle.directory);

  expect(side.check.outcome).toBe('passed');

  expect(side.unresolved).toContain('Browser error: Synthetic page error');
});

test('serializes empty and newline-terminated browser errors without losing their original text', async () => {
  const browserErrors = ['', 'Synthetic page error\n'];

  const bundle = await syntheticBundle({
    observations: { ...syntheticObservations(), browserErrors },
  });

  const { result } = await Effect.runPromise(
    inspectComparison({
      baseDirectory: null,
      candidateDirectory: bundle.directory,
      evaluatedAt,
    }),
  );

  expect(result.candidate.check.outcome).toBe('passed');

  expect(result.candidate).toMatchObject({
    execution: 'complete',
    observations: { browserErrors },
  });

  const decoded = Schema.decodeUnknownSync(
    Schema.fromJsonString(comparisonSchema),
  )(json(result));

  expect(decoded.candidate).toMatchObject({
    execution: 'complete',
    observations: { browserErrors },
  });

  expect(decoded.candidate.unresolved).toHaveLength(2);
});

test.each([
  [1, 'passed', 'unavailable'],
  [4, 'failed', 'check-failed'],
] as const)(
  'keeps the independent candidate check with a missing baseline (%i requests)',
  async (count, outcome, conclusion) => {
    const candidate = await syntheticBundle({ count });

    const { result } = await Effect.runPromise(
      inspectComparison({
        baseDirectory: null,
        candidateDirectory: candidate.directory,
        evaluatedAt,
      }),
    );

    expect(result.candidate.check.outcome).toBe(outcome);

    expect(result.base.check.outcome).toBe('unknown');

    expect(result.comparison.kind).toBe('unavailable');

    expect(result.conclusion.kind).toBe(conclusion);

    expect(result.conclusion.text).toContain('Revision comparison unavailable');
  },
);

test('previews without a baseline or a named check, while a requested missing baseline remains unavailable', async () => {
  const bundle = await syntheticBundle({
    contract: { ...recipe, check: null },
  });
  const base = await inspect(null);
  const candidate = await inspect(bundle.directory);
  const preview = compareCaptures({
    visual: pixelsNotInspected,
    base,
    candidate,
    evaluatedAt,
    mode: 'preview',
  });

  expect(preview.comparison.kind).toBe('preview');
  expect(preview.candidate.check.outcome).toBe('not-run');
  expect(preview.conclusion.kind).toBe('preview');
  expect(
    compareCaptures({
      visual: pixelsNotInspected,
      base,
      candidate,
      evaluatedAt,
    }).comparison.kind,
  ).toBe('unavailable');

  await writeFile(
    path.join(bundle.directory, 'images/after #1.png'),
    'corrupt',
  );
  const failed = compareCaptures({
    visual: pixelsNotInspected,
    base,
    candidate: await inspect(bundle.directory),
    evaluatedAt,
    mode: 'preview',
  });

  expect(failed.conclusion.kind).toBe('unavailable');
  expect(json(failed.comparison)).not.toContain('Base unavailable');
});

test.each([
  {
    observed: { selector: '#status', count: 1, value: 'Saved' },
    expected: 'passed',
  },
  {
    observed: { selector: '#status', count: 2, value: 'Saved' },
    expected: 'failed',
  },
  {
    observed: { selector: '#status', count: 1, value: 'Pending' },
    expected: 'failed',
  },
  { observed: undefined, expected: 'unknown' },
] as const)(
  'evaluates text expectations with outcome $expected',
  async ({ observed, expected }) => {
    const bundle = await syntheticBundle({
      contract: {
        ...recipe,
        check: {
          kind: 'text',
          id: 'saved',
          name: 'Saved status',
          scope: 'After saving',
          selector: '#status',
          expectedText: 'Saved',
        },
      },
      observations: {
        ...syntheticObservations(),
        ...(observed === undefined ? {} : { text: observed }),
      },
    });
    const candidate = await inspect(bundle.directory);

    expect(candidate.check.outcome).toBe(expected);
    const preview = compareCaptures({
      visual: pixelsNotInspected,
      base: await inspect(null),
      candidate,
      evaluatedAt,
      mode: 'preview',
    });
    expect(preview.conclusion.kind).toBe(
      { passed: 'preview', failed: 'check-failed', unknown: 'unavailable' }[
        expected
      ],
    );
  },
);

test('renders captured text literally instead of injecting Markdown headings or images', async () => {
  const value =
    '\n\n## Forged heading\n\n![remote](https://example.invalid/image.png)';
  const bundle = await syntheticBundle({
    contract: {
      ...recipe,
      check: {
        kind: 'text',
        id: 'status',
        name: 'Status',
        scope: 'After capture',
        selector: '#status',
        expectedText: 'Saved',
      },
    },
    observations: {
      ...syntheticObservations(),
      text: { selector: '#status', count: 1, value },
    },
  });
  const report = renderComparison(
    compareCaptures({
      visual: pixelsNotInspected,
      base: await inspect(null),
      candidate: await inspect(bundle.directory),
      evaluatedAt,
      mode: 'preview',
    }),
  );

  expect(report).not.toContain('\n\n## Forged heading');
  expect(report).not.toContain('![remote]');
  expect(report).toContain('Forged heading');
});

test.each(['application', 'conditions', 'producer', 'observed'] as const)(
  'rejects incompatible %s while preserving independent checks',
  async (field) => {
    const base = await syntheticBundle();
    const candidate = await syntheticBundle();
    const conditions = candidate.capture.conditions;

    if (conditions.kind !== 'recorded') {
      throw new Error('Synthetic fixture conditions missing');
    }

    const incompatible = {
      producer: { producer: { name: 'another-collector', version: '2' } },
      observed: { observed: { ...observed, version: '0.0.1-synthetic' } },
      application: { application: 'A different application' },
      conditions: {
        conditions: {
          kind: 'recorded',
          value: { ...conditions.value, browser: 'Another browser' },
        },
      },
    };

    await saveManifest(candidate.directory, {
      ...candidate.capture,
      ...incompatible[field],
    });

    const result = compareCaptures({
      visual: pixelsNotInspected,
      base: await inspect(base.directory),
      candidate: await inspect(candidate.directory),
      evaluatedAt,
    });

    expect(result.candidate.check.outcome).toBe('passed');

    expect(result.comparison.kind).toBe('unavailable');

    expect(json(result.comparison)).toContain(
      {
        application: 'different applications',
        producer: 'producers differ',
        observed: 'Observed versions differ',
        conditions: 'conditions differ',
      }[field],
    );
  },
);

test('discloses captures from different Observed commits under one version without blocking the comparison', async () => {
  const base = await syntheticBundle();
  const candidate = await syntheticBundle();

  await saveManifest(candidate.directory, {
    ...candidate.capture,
    observed: {
      ...observed,
      source: { kind: 'git', commit: 'c'.repeat(40), trackedChanges: true },
    },
  });

  const result = compareCaptures({
    visual: pixelsNotInspected,
    base: await inspect(base.directory),
    candidate: await inspect(candidate.directory),
    evaluatedAt,
  });

  expect(result.comparison.kind).toBe('available');
  expect(result.limitations.join('\n')).toContain(
    `Candidate: 0.0.0-synthetic; commit ${'c'.repeat(40)} with uncommitted tracked changes.`,
  );
});

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
  expect(side.check.detail).toContain(
    'Capture manifest schema version 3 is unsupported',
  );

  const root = await mkdtemp(path.join(tmpdir(), 'observed-legacy-export-'));
  directories.push(root);
  await mkdir(path.join(root, 'viewer'));
  await writeFile(path.join(root, 'viewer/index.html'), '<!doctype html>');

  const exported = await Effect.runPromise(
    exportComparison({
      baseDirectory: base.directory,
      candidateDirectory: candidate.directory,
      directory: path.join(root, 'report'),
      viewerDirectory: path.join(root, 'viewer'),
    }).pipe(
      Effect.provideService(Clock.Clock, clockAt(evaluatedAt)),
      Effect.provide(BunServices.layer),
    ),
  );

  expect(exported.result.comparison).toMatchObject({ kind: 'unavailable' });
  expect(json(exported.result.comparison)).toContain(
    'Baseline unavailable: Capture manifest schema version 3 is unsupported',
  );
  expect(exported.result.candidate.check.outcome).toBe('passed');
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
    artifacts: bundle.capture.artifacts.filter(
      (artifact) => artifact.id !== id,
    ),
  });

  const side = await inspect(bundle.directory);

  expect(side.check.outcome).toBe('unknown');

  expect(side.execution).toBe('unavailable');

  expect(side.check.detail).toContain('missing');
});

test('checks all supplied artifacts rather than only those used by the named check', async () => {
  const bundle = await syntheticBundle();

  await writeFile(
    path.join(bundle.directory, 'requests.json'),
    'corrupted raw request evidence',
  );

  const side = await inspect(bundle.directory);

  expect(side.check.outcome).toBe('unknown');

  const requests = side.artifacts.find(
    (artifact) => artifact.id === 'requests',
  );

  expect(requests?.integrity).toBe('unavailable');
  expect(requests).not.toHaveProperty('path');

  expect(side.check.detail).toContain('SHA-256 mismatch');
});

test('requires protected recipe bytes even when the artifact digest was updated', async () => {
  const bundle = await syntheticBundle();

  await replaceArtifact(
    bundle,
    'recipe',
    json({ ...recipe, check: { ...recipe.check, expectedCount: 4 } }),
  );

  const side = await inspect(bundle.directory);

  expect(side.check.outcome).toBe('unknown');

  expect(side.check.detail).toContain('protected recipe');
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

    expect(side.check.outcome).toBe('unknown');

    expect(side.check.detail).toContain('Source');
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

  expect((await inspect(bundle.directory)).check.outcome).toBe('passed');
});

test.each(['manifestHash', 'sourceHash'] as const)(
  'rejects selection %s mismatch',
  async (field) => {
    const bundle = await syntheticBundle();

    const selection: Selection = {
      schemaVersion: 1,
      evaluatedAt,
      base: null,
      candidate: {
        manifestHash: sha256(
          await readFile(path.join(bundle.directory, 'capture.json')),
        ),
        sourceHash: bundle.capture.source.sha256,
        [field]: sha256('a different selection'),
      },
    };

    const { result } = await Effect.runPromise(
      inspectComparison({
        baseDirectory: null,
        candidateDirectory: bundle.directory,
        evaluatedAt,
        selection,
      }),
    );

    expect(result.candidate.check.outcome).toBe('unknown');

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

    expect(side.check.outcome).toBe('unknown');

    expect(side.execution).toBe(
      problem === 'failed' ? 'capture-failed' : 'unavailable',
    );
  },
);

test('accepts the maximum age boundary and rejects stale or future captures', async () => {
  const bundle = await syntheticBundle();

  const lastValidTime = new Date(
    Date.parse(bundle.capture.finishedAt) + recipe.maxAgeMs,
  ).toISOString();

  const staleTime = new Date(Date.parse(lastValidTime) + 1).toISOString();

  expect((await inspect(bundle.directory, lastValidTime)).check.outcome).toBe(
    'passed',
  );

  expect((await inspect(bundle.directory, staleTime)).check.detail).toContain(
    'stale',
  );

  expect(
    (await inspect(bundle.directory, bundle.capture.startedAt)).check.detail,
  ).toContain('future');
});

test('keeps the current candidate check when the baseline is stale', async () => {
  const base = await syntheticBundle();
  const candidate = await syntheticBundle();

  await saveManifest(base.directory, {
    ...base.capture,
    startedAt: '2026-09-21T11:59:50.000Z',
    finishedAt: '2026-09-21T11:59:59.000Z',
  });

  const result = compareCaptures({
    visual: pixelsNotInspected,
    base: await inspect(base.directory),
    candidate: await inspect(candidate.directory),
    evaluatedAt,
  });

  expect(result.base.check.detail).toContain('stale');

  expect(result.candidate.check.outcome).toBe('passed');

  expect(result.comparison.kind).toBe('unavailable');
});

test('rechecks age during pure comparison without mutating the inspected inputs', async () => {
  const bundle = await syntheticBundle();
  const side = await inspect(bundle.directory);

  const staleAt = new Date(
    Date.parse(bundle.capture.finishedAt) + recipe.maxAgeMs + 1,
  ).toISOString();

  const first = compareCaptures({
    visual: pixelsNotInspected,
    base: side,
    candidate: side,
    evaluatedAt: staleAt,
  });

  const second = compareCaptures({
    visual: pixelsNotInspected,
    base: side,
    candidate: side,
    evaluatedAt: staleAt,
  });

  expect(first).toEqual(second);

  expect(first.comparison.kind).toBe('unavailable');

  expect(first.candidate.check.outcome).toBe('unknown');

  expect(first.candidate.check.detail).toContain('stale');

  expect(side.check.outcome).toBe('passed');
});

test.each([
  'invalid JSON',
  'wrong shape',
  'inverted window',
  'out-of-window request',
] as const)(
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

    expect(side.check.outcome).toBe('unknown');

    expect(side).not.toHaveProperty('observations');
  },
);

test.each([
  '../outside.png',
  '/absolute.png',
  'images\\after.png',
  'images/../after.png',
])('does not link unsafe artifact path %s', async (unsafePath) => {
  const bundle = await syntheticBundle();

  await saveManifest(bundle.directory, {
    ...bundle.capture,
    artifacts: bundle.capture.artifacts.map((artifact) =>
      artifact.id === 'screenshot'
        ? { ...artifact, path: unsafePath }
        : artifact,
    ),
  });

  const side = await inspect(bundle.directory);

  expect(side.check.outcome).toBe('unknown');

  expect(side.screenshot).toBeNull();

  const screenshot = side.artifacts.find(
    (artifact) => artifact.id === 'screenshot',
  );

  expect(screenshot?.integrity).toBe('unavailable');
  expect(screenshot).not.toHaveProperty('path');
});

test('rejects symlink artifacts even when their target has the expected bytes', async () => {
  const bundle = await syntheticBundle();
  const outside = await syntheticBundle();
  const image = 'images/after #1.png';

  await rm(path.join(bundle.directory, image));

  await symlink(
    path.join(outside.directory, image),
    path.join(bundle.directory, image),
  );

  const side = await inspect(bundle.directory);

  expect(side.check.outcome).toBe('unknown');

  expect(side.check.detail).toContain('Symlink');

  expect(side.screenshot).toBeNull();
});

test('rejects missing files, malformed manifests, and absent conditions instead of manufacturing empty success', async () => {
  const bundle = await syntheticBundle();

  await rm(path.join(bundle.directory, 'errors.json'));

  expect((await inspect(bundle.directory)).check.detail).toContain('ENOENT');

  await writeFile(path.join(bundle.directory, 'capture.json'), '{');

  expect((await inspect(bundle.directory)).check.detail).toContain('malformed');

  await saveManifest(bundle.directory, {
    ...bundle.capture,
    conditions: undefined,
  });

  expect((await inspect(bundle.directory)).check.outcome).toBe('unknown');

  await rm(path.join(bundle.directory, 'capture.json'));

  expect((await inspect(bundle.directory)).check.detail).toContain('ENOENT');
});
