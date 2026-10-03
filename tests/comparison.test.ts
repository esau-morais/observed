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
import { checkKinds, type CheckDefinition } from '../src/checks';
import { evidenceKinds, type EvidenceValue } from '../src/evidence-kinds';
import {
  fixtureHash,
  observed,
  producer,
  recipe,
} from './support/request-recipe';
import { browserErrors } from '../src/checks/browser-errors';
import { defineCheck, perSide, type CheckInput } from '../src/checks/define';
import {
  compareJourney,
  evaluateCheck,
  inspectComparison,
  inspectJourney,
  inspectSide,
  summarizeJourneys,
} from '../src/comparison';
import {
  comparisonSchema,
  journeySchema,
  type Journey,
  type Selection,
  type Visual,
} from '../src/comparison-model';
import { renderComparison } from '../src/comparison-report';
import { exportComparison } from '../src/export';
import { encodeRgbPng } from '../src/png';
import { serveReport } from '../src/view';
import { checkRows } from '../scripts/github-action';
import { resultCounts } from '../src/result-text';
import { collectReport } from '../src/playwright/collect';
import type { Journey as ProjectJourney } from '../src/project';
import { recipePlan } from '../src/recipe-diff';
import { parseJsonReport } from '../src/playwright/report';

const evaluatedAt = '2026-09-23T12:00:00.000Z';
const whitePng = encodeRgbPng(4, 4, new Uint8Array(4 * 4 * 3).fill(255));
const pixelsNotInspected: Visual = {
  kind: 'unavailable',
  reason: 'Synthetic sides without screenshot pixels',
};
const directories: string[] = [];
const [requestCheck] = recipe.checks;

function single(
  journey: Journey,
  mode: 'preview' | 'comparison' = 'comparison',
) {
  return summarizeJourneys({ journeys: [journey], evaluatedAt, mode });
}

function syntheticObservations(count = 1): Observations {
  return {
    schemaVersion: 3,
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
    text?: EvidenceValue<'text'>;
    performance?: EvidenceValue<'performance'>;
    browserErrors?: EvidenceValue<'browser-errors'>;
    playwright?: EvidenceValue<'playwright'>;
    files?: { path: string; content: string }[];
    artifacts?: { id: string; path: string; text: string }[];
  } = {},
) {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'observed-comparison-test-'),
  );

  directories.push(directory);

  const files = options.files ?? [
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
    ...(options.text === undefined
      ? []
      : [
          {
            id: 'evidence-text',
            path: 'evidence/text.json',
            text: json({ kind: 'text', schemaVersion: 1, value: options.text }),
          },
        ]),
    ...(options.performance === undefined
      ? []
      : [
          {
            id: 'evidence-performance',
            path: 'evidence/performance.json',
            text: json({
              kind: 'performance',
              schemaVersion: 1,
              value: options.performance,
            }),
          },
        ]),
    ...(options.browserErrors === undefined
      ? []
      : [
          {
            id: 'evidence-browser-errors',
            path: 'evidence/browser-errors.json',
            text: json({
              kind: 'browser-errors',
              schemaVersion: 1,
              value: options.browserErrors,
            }),
          },
        ]),
    ...(options.playwright === undefined
      ? []
      : [
          {
            id: 'evidence-playwright',
            path: 'evidence/playwright.json',
            text: json({
              kind: 'playwright',
              schemaVersion: 1,
              value: options.playwright,
            }),
          },
        ]),
    ...files.map((file, index) => ({
      id: `arbitrary-source-id-${index}`,
      path: `source/${file.path}`,
      text: file.content,
    })),
    ...(options.artifacts ?? []),
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
    schemaVersion: 5,
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
    evidence: artifacts.flatMap((artifact) =>
      artifact.id.startsWith('evidence-')
        ? [
            {
              kind: artifact.id.slice('evidence-'.length),
              schemaVersion: 1,
              status: 'recorded' as const,
              path: artifact.path,
              sha256: artifact.sha256,
              producer,
              conditions: {},
            },
          ]
        : [],
    ),
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
      journeys: [
        {
          baseDirectory: base.directory,
          candidateDirectory: candidate.directory,
        },
      ],
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

  const { journey: result } = await Effect.runPromise(
    inspectJourney({
      baseDirectory: base.directory,
      candidateDirectory: candidate.directory,
      evaluatedAt,
    }),
  );

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
    result.base.artifacts.find(
      (artifact) => artifact.id === 'arbitrary-source-id-1',
    ),
  ).toMatchObject({
    integrity: 'verified',
    path: 'base/source/ui/%23%20details.ts',
  });

  expect(
    Schema.decodeUnknownSync(journeySchema)(JSON.parse(json(result))),
  ).toEqual(result);
});

test('rejects saved results whose side state contradicts its evidence', async () => {
  const result = compareJourney({
    visual: pixelsNotInspected,
    base: await inspect((await syntheticBundle()).directory),
    candidate: await inspect((await syntheticBundle()).directory),
    evaluatedAt,
  });
  const decode = Schema.decodeUnknownExit(journeySchema);

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
      journeys: [
        {
          baseDirectory: base.directory,
          candidateDirectory: candidate.directory,
        },
      ],
      directory: path.join(root, 'report'),
      viewerDirectory: path.join(root, 'viewer'),
    }).pipe(
      Effect.provideService(Clock.Clock, clockAt(evaluatedAt)),
      Effect.provide(BunServices.layer),
    ),
  );

  expect(exported.result.conclusion.kind).toBe('no-regression');
  expect(exported.result.journeys[0].comparison).toMatchObject({
    kind: 'available',
    requestDifference: 0,
    visual: {
      kind: 'changed',
      differingPixels: 1,
      changedPixels: 1,
      regionCount: 1,
      regions: [{ x: 1, y: 2, width: 1, height: 1, changedPixels: 1 }],
      diff: { path: 'journey-1/visual-diff.png' },
    },
  });

  if (
    exported.result.journeys[0].comparison.kind !== 'available' ||
    exported.result.journeys[0].comparison.visual.kind !== 'changed'
  ) {
    throw new Error('Expected a changed pixel observation');
  }

  const diff = exported.result.journeys[0].comparison.visual.diff;
  const saved = await readFile(path.join(exported.directory, diff.path));
  expect(sha256(saved)).toBe(diff.sha256);
  expect(
    await readFile(path.join(exported.directory, 'report.md'), 'utf8'),
  ).toContain('(<journey-1/visual-diff.png>)');

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

  const { journey: result, visualDiff } = await Effect.runPromise(
    inspectJourney({
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

  const { journey: result, visualDiff } = await Effect.runPromise(
    inspectJourney({
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
      artifact.id === 'recipe'
        ? { ...artifact, sha256: sha256(contractText) }
        : artifact,
    ),
  });

  expect((await inspect(bundle.directory)).checks[0]).toMatchObject({
    outcome: 'passed',
    actual: 2,
  });
});

test.each([0, 2])(
  'fails the named count check for %i requests without inventing a regression from a failing base',
  async (count) => {
    const base = await syntheticBundle({ count: 3 });
    const candidate = await syntheticBundle({ count });

    const result = compareJourney({
      visual: pixelsNotInspected,
      base: await inspect(base.directory),
      candidate: await inspect(candidate.directory),
      evaluatedAt,
    });

    expect(result.candidate.checks[0]).toMatchObject({
      outcome: 'failed',
      actual: count,
    });

    expect(result.comparison.kind).toBe('available');

    expect(result.conclusion.kind).toBe('check-failed');

    expect(result.conclusion.text).toContain(
      'Base also failed, so a regression is not established',
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
  for (const definition of [
    requestCheck,
    { ...requestCheck, origin, status: 202 },
  ]) {
    const bundle = await syntheticBundle({
      contract: { ...recipe, allowedOrigins: [origin], checks: [definition] },
      observations: { ...observations, requests },
    });
    const side = await inspect(bundle.directory);
    expect(side.checks[0]).toMatchObject({
      outcome: 'passed',
      actual: 1,
    });
    const report = renderComparison(
      single(
        compareJourney({
          visual: pixelsNotInspected,
          base: side,
          candidate: side,
          evaluatedAt,
        }),
      ),
    );
    expect(report).toContain('| GET | /api/items | 200 |');
    expect(report).toContain(
      '| GET | https://api\\.example\\.test/api/items | 202 |',
    );
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
  const side = await inspect(
    (await errorsBundle({ kind: 'complete' })).directory,
  );

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

  const { journey: result } = await Effect.runPromise(
    inspectJourney({
      baseDirectory: null,
      candidateDirectory: bundle.directory,
      evaluatedAt,
    }),
  );

  expect(result.candidate.checks[0]?.outcome).toBe('passed');

  expect(result.candidate).toMatchObject({
    execution: 'complete',
    observations: { browserErrors },
  });

  const decoded = Schema.decodeUnknownSync(
    Schema.fromJsonString(comparisonSchema),
  )(json(single(result)));

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

    const { journey: result } = await Effect.runPromise(
      inspectJourney({
        baseDirectory: null,
        candidateDirectory: candidate.directory,
        evaluatedAt,
      }),
    );

    expect(result.candidate.checks[0]?.outcome).toBe(outcome);

    expect(result.base.checks[0]?.outcome).toBe('unknown');

    expect(result.comparison.kind).toBe('unavailable');

    expect(result.conclusion.kind).toBe(conclusion);

    expect(result.conclusion.text).toContain('The revisions were not compared');
  },
);

test('previews without a baseline or a named check, while a requested missing baseline remains unavailable', async () => {
  const bundle = await syntheticBundle({
    contract: { ...recipe, checks: [] },
  });
  const base = await inspect(null);
  const candidate = await inspect(bundle.directory);
  const preview = compareJourney({
    visual: pixelsNotInspected,
    base,
    candidate,
    evaluatedAt,
    mode: 'preview',
  });

  expect(preview.comparison.kind).toBe('preview');
  expect(preview.candidate.checks).toEqual([]);
  expect(preview.checks).toEqual([]);
  expect(preview.conclusion.kind).toBe('preview');
  expect(
    compareJourney({
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
  const failed = compareJourney({
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
  {
    observed: { selector: '#other', count: 1, value: 'Saved' },
    expected: 'unknown',
  },
] as const)(
  'evaluates text expectations with outcome $expected',
  async ({ observed, expected }) => {
    const bundle = await syntheticBundle({
      contract: {
        ...recipe,
        checks: [
          {
            kind: 'text',
            id: 'saved',
            name: 'Saved status',
            scope: 'After saving',
            selector: '#status',
            expectedText: 'Saved',
          },
        ],
        collectors: [{ kind: 'text', selectors: ['#status'] }],
      },
      ...(observed === undefined ? {} : { text: { elements: [observed] } }),
    });
    const candidate = await inspect(bundle.directory);

    expect(candidate.checks[0]?.outcome).toBe(expected);
    const preview = compareJourney({
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
    const compared = compareJourney({
      visual: pixelsNotInspected,
      base: candidate,
      candidate,
      evaluatedAt,
    });
    expect(compared.conclusion.kind).toBe(
      {
        passed: 'no-regression',
        failed: 'check-failed',
        unknown: 'unavailable',
      }[expected],
    );
  },
);

test('renders captured text literally instead of injecting Markdown headings or images', async () => {
  const value =
    '\n\n## Forged heading\n\n![remote](https://example.invalid/image.png)';
  const bundle = await syntheticBundle({
    contract: {
      ...recipe,
      checks: [
        {
          kind: 'text',
          id: 'status',
          name: 'Status',
          scope: 'After capture',
          selector: '#status',
          expectedText: 'Saved',
        },
      ],
      collectors: [{ kind: 'text', selectors: ['#status'] }],
    },
    text: { elements: [{ selector: '#status', count: 1, value }] },
  });
  const report = renderComparison(
    single(
      compareJourney({
        visual: pixelsNotInspected,
        base: await inspect(null),
        candidate: await inspect(bundle.directory),
        evaluatedAt,
        mode: 'preview',
      }),
      'preview',
    ),
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

    const result = compareJourney({
      visual: pixelsNotInspected,
      base: await inspect(base.directory),
      candidate: await inspect(candidate.directory),
      evaluatedAt,
    });

    expect(result.candidate.checks[0]?.outcome).toBe('passed');

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

const dirtySource = { ...observed.source, trackedChanges: true } as const;
const unknownSource = {
  kind: 'unavailable',
  reason: 'Synthetic tarball install',
} as const;

test.each([
  {
    name: 'different commits',
    base: observed.source,
    candidate: { ...observed.source, commit: 'c'.repeat(40) },
    expected: [
      `from different commits (base ${'a'.repeat(40)}, candidate ${'c'.repeat(40)})`,
    ],
  },
  {
    name: 'uncommitted changes on both sides of one commit',
    base: dirtySource,
    candidate: dirtySource,
    expected: [
      'The base capture ran Observed 0.0.0-synthetic with uncommitted tracked changes',
      'The candidate capture ran Observed 0.0.0-synthetic with uncommitted tracked changes',
    ],
  },
  {
    name: 'one unknown commit',
    base: observed.source,
    candidate: unknownSource,
    expected: [
      "Observed's source commit is unknown for the candidate capture",
      'candidate: Synthetic tarball install',
    ],
  },
  {
    name: 'two unknown commits',
    base: unknownSource,
    candidate: unknownSource,
    expected: ["Observed's source commit is unknown for both captures"],
  },
])(
  'discloses Observed code that may differ under one version without blocking the comparison: $name',
  async (sources) => {
    const base = await syntheticBundle();
    const candidate = await syntheticBundle();

    for (const [bundle, source] of [
      [base, sources.base],
      [candidate, sources.candidate],
    ] as const) {
      await saveManifest(bundle.directory, {
        ...bundle.capture,
        observed: { ...observed, source },
      });
    }

    const result = compareJourney({
      visual: pixelsNotInspected,
      base: await inspect(base.directory),
      candidate: await inspect(candidate.directory),
      evaluatedAt,
    });
    const limitations = result.limitations.join('\n');

    expect(result.comparison.kind).toBe('available');

    for (const text of sources.expected) {
      expect(limitations).toContain(text);
    }

    if (sources.name !== 'different commits') {
      expect(limitations).not.toContain('different commits');
    }
  },
);

test('adds no Observed source limitation when both captures name the same clean commit', async () => {
  const base = await syntheticBundle();
  const candidate = await syntheticBundle();

  const result = compareJourney({
    visual: pixelsNotInspected,
    base: await inspect(base.directory),
    candidate: await inspect(candidate.directory),
    evaluatedAt,
  });

  expect(result.limitations.join('\n')).not.toContain('Observed');
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
  expect(side.checks[0]?.detail).toContain(
    'Capture manifest schema version 3 is unsupported',
  );

  const root = await mkdtemp(path.join(tmpdir(), 'observed-legacy-export-'));
  directories.push(root);
  await mkdir(path.join(root, 'viewer'));
  await writeFile(path.join(root, 'viewer/index.html'), '<!doctype html>');

  const exported = await Effect.runPromise(
    exportComparison({
      journeys: [
        {
          baseDirectory: base.directory,
          candidateDirectory: candidate.directory,
        },
      ],
      directory: path.join(root, 'report'),
      viewerDirectory: path.join(root, 'viewer'),
    }).pipe(
      Effect.provideService(Clock.Clock, clockAt(evaluatedAt)),
      Effect.provide(BunServices.layer),
    ),
  );

  expect(exported.result.journeys[0].comparison).toMatchObject({
    kind: 'unavailable',
  });
  expect(json(exported.result.journeys[0].comparison)).toContain(
    'Baseline unavailable: Capture manifest schema version 3 is unsupported',
  );
  expect(exported.result.journeys[0].candidate.checks[0]?.outcome).toBe(
    'passed',
  );
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
    artifacts: bundle.capture.artifacts.filter(
      (artifact) => artifact.id !== id,
    ),
  });

  const side = await inspect(bundle.directory);

  expect(side.checks[0]?.outcome).toBe('unknown');

  expect(side.execution).toBe('unavailable');

  expect(side.checks[0]?.detail).toContain('missing');
});

test('checks all supplied artifacts rather than only those used by the named check', async () => {
  const bundle = await syntheticBundle();

  await writeFile(
    path.join(bundle.directory, 'requests.json'),
    'corrupted raw request evidence',
  );

  const side = await inspect(bundle.directory);

  expect(side.checks[0]?.outcome).toBe('unknown');

  const requests = side.artifacts.find(
    (artifact) => artifact.id === 'requests',
  );

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

    const selection: Selection['journeys'][number] = {
      directory: 'journey-1',
      base: null,
      candidate: {
        manifestHash: sha256(
          await readFile(path.join(bundle.directory, 'capture.json')),
        ),
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

    expect(side.execution).toBe(
      problem === 'failed' ? 'capture-failed' : 'unavailable',
    );
  },
);

async function failedSide(reason: string) {
  const bundle = await syntheticBundle();
  const written = new Set(['requests', 'errors', 'screenshot', 'observations']);

  await saveManifest(bundle.directory, {
    ...bundle.capture,
    execution: { kind: 'failed', category: 'application', reason },
    conditions: {
      kind: 'unavailable',
      reason: 'Browser conditions were not captured',
    },
    artifacts: bundle.capture.artifacts.filter(
      (artifact) => !written.has(artifact.id),
    ),
  });

  return inspect(bundle.directory);
}

test('a failed capture is one reason, and a base failing the same way is named once, never passed', async () => {
  const stale = 'Setup step 2 of 2 (sh) exited with code 1: fixture is stale';
  const base = await failedSide(stale);
  const candidate = await failedSide(stale);

  expect(candidate.execution).toBe('capture-failed');
  expect(candidate.unresolved).toEqual([
    `Capture failed (application): ${stale}`,
  ]);

  const journey = compareJourney({
    visual: pixelsNotInspected,
    base,
    candidate,
    evaluatedAt,
  });

  expect(journey.comparison).toEqual({
    kind: 'unavailable',
    reasons: [
      `Base and candidate unavailable for the same reason: Capture failed (application): ${stale}`,
    ],
  });
  expect(journey.conclusion.kind).toBe('unavailable');
  expect(journey.conclusion.text).toMatch(/^Both captures failed/);
  expect(journey.checks.every((check) => check.verdict === 'unknown')).toBe(
    true,
  );

  const differs = compareJourney({
    visual: pixelsNotInspected,
    base: await failedSide('Setup step 1 of 2 (bun) exited with code 1: x'),
    candidate,
    evaluatedAt,
  });

  expect(differs.comparison).toMatchObject({
    reasons: [
      expect.stringMatching(/^Base unavailable: /),
      expect.stringMatching(/^Candidate unavailable: /),
    ],
  });
  expect(
    summarizeJourneys({
      journeys: [
        { ...journey, title: 'One' },
        { ...journey, title: 'Two' },
      ],
      evaluatedAt,
      mode: 'comparison',
    }).conclusion,
  ).toEqual({
    kind: 'unavailable',
    text: 'Every capture failed, so no journey was compared. 2 checks are unknown.',
  });
});

test('accepts the maximum age boundary and rejects stale or future captures', async () => {
  const bundle = await syntheticBundle();

  const lastValidTime = new Date(
    Date.parse(bundle.capture.finishedAt) + recipe.maxAgeMs,
  ).toISOString();

  const staleTime = new Date(Date.parse(lastValidTime) + 1).toISOString();

  expect(
    (await inspect(bundle.directory, lastValidTime)).checks[0]?.outcome,
  ).toBe('passed');

  expect(
    (await inspect(bundle.directory, staleTime)).checks[0]?.detail,
  ).toContain('stale');

  expect(
    (await inspect(bundle.directory, bundle.capture.startedAt)).checks[0]
      ?.detail,
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

  const result = compareJourney({
    visual: pixelsNotInspected,
    base: await inspect(base.directory),
    candidate: await inspect(candidate.directory),
    evaluatedAt,
  });

  expect(result.base.checks[0]?.detail).toContain('stale');

  expect(result.candidate.checks[0]?.outcome).toBe('passed');

  expect(result.comparison.kind).toBe('unavailable');
});

test('rechecks age during pure comparison without mutating the inspected inputs', async () => {
  const bundle = await syntheticBundle();
  const side = await inspect(bundle.directory);

  const staleAt = new Date(
    Date.parse(bundle.capture.finishedAt) + recipe.maxAgeMs + 1,
  ).toISOString();

  const first = compareJourney({
    visual: pixelsNotInspected,
    base: side,
    candidate: side,
    evaluatedAt: staleAt,
  });

  const second = compareJourney({
    visual: pixelsNotInspected,
    base: side,
    candidate: side,
    evaluatedAt: staleAt,
  });

  expect(first).toEqual(second);

  expect(first.comparison.kind).toBe('unavailable');

  expect(first.candidate.checks[0]?.outcome).toBe('unknown');

  expect(first.candidate.checks[0]?.detail).toContain('stale');

  expect(side.checks[0]?.outcome).toBe('passed');
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

    expect(side.checks[0]?.outcome).toBe('unknown');

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

  expect(side.checks[0]?.outcome).toBe('unknown');

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

  expect(side.checks[0]?.outcome).toBe('unknown');

  expect(side.checks[0]?.detail).toContain('Symlink');

  expect(side.screenshot).toBeNull();
});

test('rejects missing files, malformed manifests, and absent conditions instead of manufacturing empty success', async () => {
  const bundle = await syntheticBundle();

  await rm(path.join(bundle.directory, 'errors.json'));

  expect((await inspect(bundle.directory)).checks[0]?.detail).toContain(
    'ENOENT',
  );

  await writeFile(path.join(bundle.directory, 'capture.json'), '{');

  expect((await inspect(bundle.directory)).checks[0]?.detail).toContain(
    'malformed',
  );

  await saveManifest(bundle.directory, {
    ...bundle.capture,
    conditions: undefined,
  });

  expect((await inspect(bundle.directory)).checks[0]?.outcome).toBe('unknown');

  await rm(path.join(bundle.directory, 'capture.json'));

  expect((await inspect(bundle.directory)).checks[0]?.detail).toContain(
    'ENOENT',
  );
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

test.each([
  {
    name: 'a regression in one check wins over a passing one',
    base: { count: 1, text: statusText('Saved') },
    candidate: { count: 4, text: statusText('Saved') },
    conclusion: 'regression',
    verdicts: ['regression', 'passed'],
    passed: 1,
  },
  {
    name: 'a failed check wins over an unknown one',
    base: { count: 4, text: statusText('Saved') },
    candidate: { count: 4, text: undefined },
    conclusion: 'check-failed',
    verdicts: ['failed', 'unknown'],
    passed: 0,
  },
  {
    name: 'an unknown check makes a passing journey unavailable',
    base: { count: 1, text: statusText('Saved') },
    candidate: { count: 1, text: undefined },
    conclusion: 'unavailable',
    verdicts: ['passed', 'unknown'],
    passed: 1,
  },
  {
    name: 'all checks passing is no regression',
    base: { count: 1, text: statusText('Pending') },
    candidate: { count: 1, text: statusText('Saved') },
    conclusion: 'no-regression',
    verdicts: ['passed', 'passed'],
    passed: 2,
  },
] as const)(
  'aggregates several checks in one journey: $name',
  async ({ base, candidate, conclusion, verdicts, passed }) => {
    const sides = await Promise.all(
      [base, candidate].map(async ({ count, text }) =>
        inspect(
          (
            await syntheticBundle({
              count,
              contract: twoChecks,
              ...(text === undefined ? {} : { text }),
            })
          ).directory,
        ),
      ),
    );
    const [before, after] = sides;

    if (before === undefined || after === undefined) {
      throw new Error('Two sides expected');
    }

    const result = single(
      compareJourney({
        visual: pixelsNotInspected,
        base: before,
        candidate: after,
        evaluatedAt,
      }),
    );
    const [journey] = result.journeys;

    expect(result.conclusion.kind).toBe(conclusion);
    expect(journey.checks.map((check) => check.verdict)).toEqual(verdicts);
    expect(journey.checks.map((check) => check.scope)).toEqual([
      requestCheck.scope,
      savedText.scope,
    ]);
    expect(result.summary).toEqual({ passed, total: 2 });

    if (conclusion === 'unavailable') {
      expect(result.conclusion.text).toContain('Saved status: unknown');
      expect(result.conclusion.text).toContain(
        'Element text evidence unavailable',
      );
    }
  },
);

test('a regression in any journey decides the run and names that journey', async () => {
  const side = async (count: number, id: string) =>
    inspect(
      (await syntheticBundle({ count, contract: { ...recipe, id, name: id } }))
        .directory,
    );
  const journey = async (id: string, candidateCount: number) =>
    compareJourney({
      visual: pixelsNotInspected,
      base: await side(1, id),
      candidate: await side(candidateCount, id),
      evaluatedAt,
    });

  const result = summarizeJourneys({
    journeys: [await journey('Browse', 1), await journey('Checkout', 4)],
    evaluatedAt,
    mode: 'comparison',
  });

  expect(result.journeys.map((item) => item.conclusion.kind)).toEqual([
    'no-regression',
    'regression',
  ]);
  expect(result.conclusion.kind).toBe('regression');
  expect(result.conclusion.text).toMatch(/^Checkout: /);
  expect(result.summary).toEqual({ passed: 1, total: 2 });
  expect(
    Schema.decodeUnknownSync(comparisonSchema)(JSON.parse(json(result))),
  ).toEqual(result);
});

test('evidence recorded under different conditions is not comparable', async () => {
  const base = await syntheticBundle({
    contract: twoChecks,
    text: statusText('Saved'),
  });
  const candidate = await syntheticBundle({
    contract: twoChecks,
    text: statusText('Saved'),
  });

  await saveManifest(candidate.directory, {
    ...candidate.capture,
    evidence: candidate.capture.evidence.map((entry) =>
      entry.status === 'recorded'
        ? { ...entry, conditions: { samples: 3 } }
        : entry,
    ),
  });

  const result = compareJourney({
    visual: pixelsNotInspected,
    base: await inspect(base.directory),
    candidate: await inspect(candidate.directory),
    evaluatedAt,
  });

  expect(result.comparison).toMatchObject({
    kind: 'unavailable',
    reasons: [
      'text evidence was recorded under different versions or conditions',
    ],
  });
  expect(result.conclusion.kind).toBe('unavailable');
});

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
  expect(side.checks.map((check) => check.outcome)).toEqual([
    'unknown',
    'unknown',
  ]);
});

const sameText = defineCheck({
  definition: Schema.Struct({
    kind: Schema.Literal('same-text'),
    id: Schema.String,
    name: Schema.String,
    scope: Schema.String,
  }),
  evidence: ['text'],
  collectors: () => [],
  expectation: () => 'The candidate shows the base text.',
  needsBase: true,
  evaluate: ({ base, candidate }) => {
    const value = (input: CheckInput<'text'>) =>
      input.evidence.text.elements[0]?.value ?? null;

    if (base === null) {
      return {
        base: null,
        candidate: { outcome: 'not-run', actual: null, detail: 'No base.' },
      };
    }

    return {
      base: { outcome: 'passed', actual: value(base), detail: 'Reference.' },
      candidate: {
        outcome: value(base) === value(candidate) ? 'passed' : 'failed',
        actual: value(candidate),
        detail: 'Compared with the base.',
      },
    };
  },
});

const newValues = defineCheck({
  definition: sameText.definition,
  evidence: sameText.evidence,
  collectors: sameText.collectors,
  expectation: sameText.expectation,
  evaluate: perSide((_, side: CheckInput<'text'>) => ({
    outcome: 'failed',
    actual: side.evidence.text.elements.length,
    detail: 'Some values are wrong.',
  })),
  regression: ({ base, candidate }) =>
    candidate.evidence.text.elements.length > base.evidence.text.elements.length
      ? { detail: 'The candidate shows a value the base did not.' }
      : null,
});

const probe = {
  kind: 'same-text',
  id: 'same',
  name: 'Same text',
  scope: 'After saving',
} as const;

async function completeSide(text?: EvidenceValue<'text'>) {
  const side = await inspect(
    (
      await syntheticBundle({
        contract: twoChecks,
        ...(text === undefined ? {} : { text }),
      })
    ).directory,
  );

  if (side.execution !== 'complete') {
    throw new Error('A complete synthetic side is expected');
  }

  return side;
}

test('a check that compares sides is unknown without a usable, comparable base', async () => {
  const candidate = await completeSide(statusText('Saved'));
  const cases = [
    {
      base: await completeSide(),
      comparable: true,
      detail: 'Base: Element text evidence unavailable',
    },
    {
      base: await completeSide(statusText('Saved')),
      comparable: false,
      detail: 'Base: not comparable with the candidate',
    },
    { base: null, comparable: false, detail: 'Base: capture unavailable' },
  ];

  for (const { base, comparable, detail } of cases) {
    const pair = evaluateCheck(sameText, probe, {
      base,
      candidate,
      mode: 'comparison',
      comparable,
    });

    expect(pair.candidate.outcome).toBe('unknown');
    expect(pair.candidate.detail).toContain(detail);
    expect(pair.regression).toBeNull();
  }

  expect(
    evaluateCheck(sameText, probe, {
      base: null,
      candidate,
      mode: 'preview',
      comparable: false,
    }).candidate.outcome,
  ).toBe('not-run');
  expect(
    evaluateCheck(sameText, probe, {
      base: await completeSide(statusText('Pending')),
      candidate,
      mode: 'comparison',
      comparable: true,
    }).candidate,
  ).toMatchObject({ outcome: 'failed', actual: 'Saved' });
});

test('a regression hook decides failed-to-failed pairs and never runs without base evidence', async () => {
  const two = {
    elements: [
      { selector: '#status', count: 1, value: 'Saved' },
      { selector: '#total', count: 1, value: '3' },
    ],
  };
  const pair = (base: Awaited<ReturnType<typeof completeSide>>) =>
    evaluateCheck(newValues, probe, {
      base,
      candidate,
      mode: 'comparison',
      comparable: true,
    });
  const candidate = await completeSide(two);

  expect(pair(await completeSide(statusText('Saved')))).toMatchObject({
    base: { outcome: 'failed' },
    candidate: { outcome: 'failed' },
    regression: 'The candidate shows a value the base did not.',
  });
  expect(pair(await completeSide(two)).regression).toBeNull();
  expect(pair(await completeSide())).toMatchObject({
    candidate: { outcome: 'unknown' },
    regression: null,
  });
});

const performanceBudget = Schema.decodeUnknownSync(
  checkKinds.performance.definition,
)({
  kind: 'performance',
  id: 'lcp-budget',
  name: 'Largest contentful paint budget',
  scope: 'Open the page through the journey.',
  metric: 'lcp',
  max: 200,
});

async function performanceSide(file: string) {
  const side = await inspect(
    (
      await syntheticBundle({
        contract: twoChecks,
        performance: Schema.decodeUnknownSync(
          Schema.fromJsonString(evidenceKinds.performance.value),
        )(
          await readFile(
            new URL(`fixtures/performance/${file}`, import.meta.url),
            'utf8',
          ),
        ),
      })
    ).directory,
  );

  if (side.execution !== 'complete') {
    throw new Error('A complete synthetic side is expected');
  }

  return side;
}

test('an absolute performance budget still fails the candidate when the base is unusable', async () => {
  const candidate = await performanceSide('slow-document.json');

  expect(
    evaluateCheck(checkKinds.performance, performanceBudget, {
      base: null,
      candidate,
      mode: 'comparison',
      comparable: false,
    }).candidate.outcome,
  ).toBe('failed');
  const relative = evaluateCheck(
    checkKinds.performance,
    { ...performanceBudget, maxIncreasePercent: 20 },
    { base: null, candidate, mode: 'comparison', comparable: false },
  ).candidate;

  expect(relative.outcome).toBe('unknown');
  expect(relative.detail).toContain('Base: capture unavailable');
});

test('the measure delivery shows is the median each side was judged on, and unknown when a side was not judged', async () => {
  const definition = { ...performanceBudget, maxIncreasePercent: 20 };
  const candidate = await performanceSide('slow-document.json');

  expect(
    evaluateCheck(checkKinds.performance, definition, {
      base: await performanceSide('base.json'),
      candidate,
      mode: 'comparison',
      comparable: true,
    }).measure,
  ).toEqual({
    label: 'Median LCP',
    base: '32 ms',
    candidate: '428 ms',
    limit: 'at most 200 ms and +20% on base',
  });
  expect(
    evaluateCheck(checkKinds.performance, definition, {
      base: null,
      candidate,
      mode: 'comparison',
      comparable: false,
    }).measure,
  ).toMatchObject({ base: null, candidate: null });
});

test('a candidate with browser errors fails without a usable base instead of becoming unknown', async () => {
  const check = {
    kind: 'browser-errors',
    id: 'no-browser-errors',
    name: 'No browser errors',
    scope: 'One Load items click through completion and network idle.',
  } as const;
  const bundle = await syntheticBundle({
    contract: {
      ...recipe,
      checks: [check],
      collectors: [{ kind: 'browser-errors' }],
    },
    browserErrors: {
      steps: 3,
      coverage: { kind: 'complete' },
      entries: [
        {
          source: 'page',
          text: 'TypeError: total is undefined',
          step: 0,
          after: '2026-09-23T11:59:54.000Z',
          seenAt: '2026-09-23T11:59:54.300Z',
        },
      ],
    },
  });
  const candidate = await inspect(bundle.directory);

  if (candidate.execution !== 'complete') {
    throw new Error('A complete synthetic side is expected');
  }

  expect(
    evaluateCheck(browserErrors, check, {
      base: null,
      candidate,
      mode: 'comparison',
      comparable: false,
    }),
  ).toMatchObject({
    candidate: { outcome: 'failed', actual: 1 },
    regression: null,
  });
});

const withPlaywright: Recipe = {
  ...recipe,
  checks: [],
  collectors: [{ kind: 'playwright', command: ['npx', 'playwright', 'test'] }],
};

const specFile = (content: string) => [
  { path: 'e2e/cart.spec.ts', content },
  {
    path: 'main.ts',
    content: 'Synthetic source fixture, not an application.\n',
  },
];

function playwrightTest(
  title: string,
  outcome: EvidenceValue<'playwright'>['tests'][number]['outcome'],
): EvidenceValue<'playwright'>['tests'][number] {
  return {
    id: `chromium › cart.spec.ts › ${title}`,
    project: 'chromium',
    file: 'cart.spec.ts',
    source: 'e2e/cart.spec.ts',
    line: 3,
    titlePath: [title],
    outcome,
    expectedStatus: 'passed',
    annotations: [],
    results: [
      {
        retry: 0,
        status: outcome === 'expected' ? 'passed' : 'failed',
        duration: 10,
        startedAt: '2026-09-23T11:59:57.000Z',
        error: outcome === 'expected' ? null : 'Error: expected 1 item',
        attachments: [],
      },
    ],
  };
}

function playwrightRun(
  tests: EvidenceValue<'playwright'>['tests'][number][],
): EvidenceValue<'playwright'> {
  const count = (outcome: string) =>
    tests.filter((test) => test.outcome === outcome).length;

  return {
    report: 'json',
    version: '1.58.0',
    exitCode: count('unexpected') === 0 ? 0 : 1,
    startedAt: '2026-09-23T11:59:57.000Z',
    duration: 20,
    projects: ['chromium'],
    errors: [],
    stats: {
      expected: count('expected'),
      unexpected: count('unexpected'),
      flaky: count('flaky'),
      skipped: count('skipped'),
    },
    tests,
  };
}

async function playwrightJourney(options: {
  base: EvidenceValue<'playwright'>['tests'][number][];
  candidate: EvidenceValue<'playwright'>['tests'][number][];
  candidateSpec?: string;
}) {
  const base = await syntheticBundle({
    contract: withPlaywright,
    playwright: playwrightRun(options.base),
    files: specFile('test("adds an item")\n'),
  });
  const candidate = await syntheticBundle({
    contract: withPlaywright,
    playwright: playwrightRun(options.candidate),
    files: specFile(options.candidateSpec ?? 'test("adds an item")\n'),
  });

  return compareJourney({
    visual: pixelsNotInspected,
    base: await inspect(base.directory),
    candidate: await inspect(candidate.directory),
    evaluatedAt,
  });
}

test('an imported test that passed on base and fails with the same test file is a regression', async () => {
  const result = await playwrightJourney({
    base: [playwrightTest('adds an item', 'expected')],
    candidate: [playwrightTest('adds an item', 'unexpected')],
  });

  expect(result.comparison.kind).toBe('available');
  expect(result.checks).toEqual([
    expect.objectContaining({
      id: 'playwright: chromium › cart.spec.ts › adds an item',
      verdict: 'regression',
      scope: 'Imported from Playwright: cart.spec.ts:3, project chromium.',
    }),
  ]);
  expect(result.conclusion.kind).toBe('regression');
});

test('a failing imported test whose file changed is failed, not a regression', async () => {
  const result = await playwrightJourney({
    base: [playwrightTest('adds an item', 'expected')],
    candidate: [playwrightTest('adds an item', 'unexpected')],
    candidateSpec: 'test("adds two items")\n',
  });

  expect(result.comparison.kind).toBe('available');
  expect(result.checks.map((check) => check.verdict)).toEqual(['failed']);
  expect(result.checks[0]?.detail).toMatch(
    /e2e\/cart\.spec\.ts changed between base and candidate, so a regression is not established\.$/,
  );
});

test('a test the candidate adds keeps the captures comparable, and a flaky one is unknown', async () => {
  const result = await playwrightJourney({
    base: [playwrightTest('adds an item', 'expected')],
    candidate: [
      playwrightTest('adds an item', 'expected'),
      playwrightTest('removes an item', 'flaky'),
    ],
  });

  expect(result.comparison.kind).toBe('available');
  expect(result.checks.map((check) => [check.name, check.verdict])).toEqual([
    ['adds an item', 'passed'],
    ['removes an item', 'unknown'],
  ]);
  expect(result.conclusion.kind).toBe('unavailable');
});

test('missing Playwright evidence is one unknown imported check, never a pass', async () => {
  const bundle = await syntheticBundle({ contract: withPlaywright });
  const side = await inspect(bundle.directory);

  expect(side.checks).toEqual([
    expect.objectContaining({
      id: 'playwright-run',
      authority: 'Imported from Playwright',
      outcome: 'unknown',
      detail:
        'Playwright tests evidence unavailable: The capture recorded no evidence of this kind',
    }),
  ]);
});

test('a test the candidate no longer reports is unknown, not dropped', async () => {
  const result = await playwrightJourney({
    base: [
      playwrightTest('adds an item', 'expected'),
      playwrightTest('removes an item', 'expected'),
    ],
    candidate: [playwrightTest('adds an item', 'expected')],
  });

  expect(result.checks.map((check) => [check.name, check.verdict])).toEqual([
    ['adds an item', 'passed'],
    ['removes an item', 'unknown'],
  ]);
  expect(result.conclusion.kind).toBe('unavailable');
});

test('GitHub lists failures before a long run of unknown tests', async () => {
  const skipped = Array.from({ length: 60 }, (_, index) =>
    playwrightTest(`skipped ${index}`, 'skipped'),
  );
  const list = checkRows(
    single(
      await playwrightJourney({
        base: [...skipped, playwrightTest('late', 'expected')],
        candidate: [...skipped, playwrightTest('late', 'unexpected')],
      }),
    ),
  );

  expect(list[0]).toMatch(/^- ! \*\*Regression\*\* · late · /);
  expect(list.at(-1)).toBe('- More in the report: 11 unknown.');
});

test('GitHub counts the passing tests of a large imported suite and lists only the failure', async () => {
  const passing = Array.from({ length: 400 }, (_, index) =>
    playwrightTest(`case ${index}`, 'expected'),
  );
  const result = single(
    await playwrightJourney({
      base: passing,
      candidate: [...passing.slice(1), playwrightTest('case 0', 'unexpected')],
    }),
  );
  expect(result.summary).toEqual({ passed: 399, total: 400 });
  expect(resultCounts(result)).toBe('399 checks passed · 1 regression');
  expect(checkRows(result)).toEqual([
    expect.stringMatching(/^- ! \*\*Regression\*\* · case 0 · /),
  ]);
  expect(result.conclusion.text.length).toBeLessThan(2000);
});

// The seeded run in fixtures/playwright: the same spec file on both sides.
async function recordedRun(name: string, workspace: string) {
  const directory = await mkdtemp(path.join(tmpdir(), 'observed-playwright-'));
  directories.push(directory);

  return Effect.runPromise(
    Effect.gen(function* () {
      const report = yield* parseJsonReport(
        yield* Effect.promise(() =>
          readFile(
            path.join(import.meta.dirname, 'fixtures/playwright', name),
            'utf8',
          ),
        ),
      );

      return yield* collectReport({
        report,
        exitCode: report.stats.unexpected > 0 ? 1 : 0,
        root: workspace,
        workspace,
        directory,
        concealed: [],
        addArtifact: () => {},
      });
    }).pipe(Effect.provide(BunServices.layer)),
  );
}

test('the seeded Playwright run compares to one regression, with flaky and skipped tests unknown', async () => {
  const spec = 'the trial app spec, identical on both sides\n';
  const base = await syntheticBundle({
    contract: withPlaywright,
    playwright: await recordedRun('base.json', '/tmp/observed-app-t6Eogp'),
    files: [
      { path: 'e2e/shelves.spec.js', content: spec },
      { path: 'main.ts', content: 'Synthetic source fixture.\n' },
    ],
  });
  const candidate = await syntheticBundle({
    contract: withPlaywright,
    playwright: await recordedRun('candidate.json', '/tmp/observed-app-wSBHQ3'),
    files: [
      { path: 'e2e/shelves.spec.js', content: spec },
      { path: 'main.ts', content: 'Synthetic source fixture.\n' },
    ],
  });
  const result = compareJourney({
    visual: pixelsNotInspected,
    base: await inspect(base.directory),
    candidate: await inspect(candidate.directory),
    evaluatedAt,
  });

  expect(
    Object.fromEntries(
      result.checks.map((check) => [check.name, check.verdict]),
    ),
  ).toEqual({
    'shelves › starts with no shelf selected': 'passed',
    'shelves › opens the Reading shelf': 'passed',
    'shelves › opens the Finished shelf': 'regression',
    'shelves › exports the shelf as CSV': 'unknown',
    'shelves › keeps the count after a second click': 'unknown',
  });
  expect(result.conclusion.kind).toBe('regression');
});

const withErrors: Recipe = {
  ...recipe,
  checks: [
    {
      kind: 'browser-errors',
      id: 'no-browser-errors',
      name: 'No browser errors',
      scope: 'One Load items click through completion and network idle.',
    },
  ],
  collectors: [{ kind: 'browser-errors' }],
};

const appBefore = 'function open(id) {\n  load(id);\n}\n';
const appAfter = [
  'function count(id) {',
  '  window.views[id] += 1;',
  '}',
  'function open(id) {',
  '  load(id);',
  '  count(id);',
  '}',
  '',
].join('\n');

// Generated line 1: column 0 maps to src/app.js line 2 and column 10 to line
// 6, both 1-based. The node_modules source must never become an anchor.
const appMapFields = {
  version: 3,
  sources: ['../../src/app.js', '../../node_modules/lib/index.js'],
  names: [],
  mappings: 'AACA,UAIA,UCAA',
};
const appMap = json(appMapFields);

function thrown(frames: string): EvidenceValue<'browser-errors'> {
  return {
    steps: 3,
    coverage: { kind: 'complete' },
    entries: [
      {
        source: 'page',
        text: `TypeError: Cannot read properties of undefined\n${frames}`,
        step: 0,
        after: '2026-09-23T11:59:54.000Z',
        seenAt: '2026-09-23T11:59:54.300Z',
      },
    ],
  };
}

async function errorFindings(frames: string, maps: boolean, map = appMap) {
  const artifacts = maps
    ? [
        {
          id: 'source-maps',
          path: 'source-maps.json',
          text: json({
            schemaVersion: 1,
            origin: 'http://127.0.0.1:4173',
            scripts: [
              {
                script: '/assets/app.js',
                map: {
                  kind: 'recorded',
                  path: 'source-maps/1-app.js.map',
                  via: 'adjacent',
                },
              },
            ],
          }),
        },
        { id: 'source-map-1', path: 'source-maps/1-app.js.map', text: map },
      ]
    : [];
  const bundle = (
    content: string,
    browserErrors?: EvidenceValue<'browser-errors'>,
  ) =>
    syntheticBundle({
      contract: withErrors,
      browserErrors: browserErrors ?? thrown(''),
      files: [
        { path: 'main.ts', content: 'Synthetic source fixture.\n' },
        { path: 'src/app.js', content },
      ],
      artifacts,
    });
  const base = await bundle(appBefore, {
    steps: 3,
    coverage: { kind: 'complete' },
    entries: [],
  });
  const candidate = await bundle(appAfter, thrown(frames));
  const { journey } = await Effect.runPromise(
    inspectJourney({
      baseDirectory: base.directory,
      candidateDirectory: candidate.directory,
      evaluatedAt,
    }),
  );

  return journey.findings;
}

test('resolves stack frames through the recorded source map to 1-based lines of the added code', async () => {
  const findings = await errorFindings(
    [
      '    at hh (http://127.0.0.1:4173/assets/app.js:1:10)',
      '    at bl (http://127.0.0.1:4173/assets/app.js:1:11)',
      '    at lib (http://127.0.0.1:4173/assets/app.js:1:21)',
    ].join('\n'),
    true,
  );

  expect(findings).toMatchObject([
    {
      evidence: 'browser-errors',
      checks: ['no-browser-errors'],
      subject: 'TypeError thrown',
      comparison: 'new',
      location: {
        kind: 'anchored',
        anchors: [
          {
            path: 'src/app.js',
            line: 2,
            side: 'candidate',
            basis: 'stack-frame',
            diff: 'added',
            artifacts: ['candidate/source-maps/1-app.js.map'],
          },
          { path: 'src/app.js', line: 6, diff: 'added' },
        ],
      },
    },
  ]);
  expect(findings[0]?.location).toHaveProperty('anchors.length', 2);
});

test('without a source map, minified frame names give no line, and a readable name matches only its added definition', async () => {
  const minified = await errorFindings(
    '    at hh (http://127.0.0.1:4173/assets/app.js:1:10)',
    false,
  );

  expect(minified[0]?.location).toEqual({
    kind: 'unanchored',
    reason:
      'The capture has no source map index; it predates source maps or fetching them failed; no frame function is defined on an added line',
  });

  const named = await errorFindings(
    '    at count (http://127.0.0.1:4173/assets/app.js:1:10)',
    false,
  );

  expect(named[0]?.location).toMatchObject({
    kind: 'anchored',
    anchors: [
      { path: 'src/app.js', line: 1, basis: 'diff-name-match', diff: 'added' },
    ],
  });
});

test('a source map built from other code than the snapshot gives no line', async () => {
  const stale = json({
    ...appMapFields,
    sourcesContent: [appBefore, null],
  });
  const findings = await errorFindings(
    '    at hh (http://127.0.0.1:4173/assets/app.js:1:10)',
    true,
    stale,
  );

  expect(findings[0]?.location).toEqual({
    kind: 'unanchored',
    reason:
      "The source map's copy of src/app.js differs from the snapshot; no frame function is defined on an added line",
  });
});

// observed.json differences. Both sides are captured with the candidate's
// journey; the base's definitions judge them.

function projectJourney(
  checks: readonly CheckDefinition[],
  fields: Partial<ProjectJourney> = {},
): ProjectJourney {
  return {
    name: recipe.name,
    path: recipe.path,
    ready: recipe.ready,
    steps: recipe.steps,
    checks,
    viewport: recipe.viewport,
    browserArguments: recipe.browserArguments,
    maxAgeMs: recipe.maxAgeMs,
    ...fields,
  };
}

const allowsTwo = { ...requestCheck, expectedCount: 2 };

async function judgedSides(options: {
  captured: readonly CheckDefinition[];
  baseCount: number;
  candidateCount: number;
}) {
  const contract = { ...recipe, checks: options.captured };
  const base = await syntheticBundle({ count: options.baseCount, contract });
  const candidate = await syntheticBundle({
    count: options.candidateCount,
    contract,
  });

  return { base, candidate };
}

async function judged(options: {
  base: readonly CheckDefinition[] | 'unusable';
  captured: readonly CheckDefinition[];
  baseCount: number;
  candidateCount: number;
  baseFields?: Partial<ProjectJourney>;
}) {
  const bundles = await judgedSides(options);
  const plan = recipePlan(
    {
      base:
        options.base === 'unusable'
          ? {
              kind: 'unusable',
              reason: 'The base revision has no observed.json.',
            }
          : {
              kind: 'read',
              journeys: [projectJourney(options.base, options.baseFields)],
            },
      candidate: [projectJourney(options.captured)],
    },
    'unused',
  );

  return single(
    compareJourney({
      base: await Effect.runPromise(
        inspectSide({
          directory: bundles.base.directory,
          prefix: 'base',
          evaluatedAt,
        }),
      ),
      candidate: await inspect(bundles.candidate.directory),
      evaluatedAt,
      visual: pixelsNotInspected,
      judgement: plan.judge(recipe.name),
    }),
  );
}

async function selectedComparison(
  bundles: Awaited<ReturnType<typeof judgedSides>>,
  recipes: Selection['recipes'],
) {
  const root = await mkdtemp(path.join(tmpdir(), 'observed-recipe-'));
  directories.push(root);
  await mkdir(path.join(root, 'journey-1'));
  await symlink(bundles.base.directory, path.join(root, 'journey-1/base'));
  await symlink(
    bundles.candidate.directory,
    path.join(root, 'journey-1/candidate'),
  );

  const { result } = await Effect.runPromise(
    inspectComparison({
      root,
      selection: {
        schemaVersion: 2,
        evaluatedAt,
        mode: 'comparison',
        journeys: [{ directory: 'journey-1', base: null, candidate: null }],
        ...(recipes === undefined ? {} : { recipes }),
      },
    }),
  );

  return Schema.decodeUnknownSync(comparisonSchema)(JSON.parse(json(result)));
}

test('a raised expectation is judged by the base, and the proposal sets no verdict', async () => {
  // Probe E1: a duplicate request ships with expectedCount raised to 2.
  const bundles = await judgedSides({
    captured: [allowsTwo],
    baseCount: 1,
    candidateCount: 2,
  });
  const result = await selectedComparison(bundles, {
    base: { kind: 'read', journeys: [projectJourney([requestCheck])] },
    candidate: [projectJourney([allowsTwo])],
  });
  const [journey] = result.journeys;

  expect(journey?.checks).toEqual([
    expect.objectContaining({
      id: requestCheck.id,
      verdict: 'regression',
      expectation: 'Exactly 1 GET /api/items request(s) with status 200.',
      recipe: {
        change: 'altered',
        proposed: expect.objectContaining({
          expectation: 'Exactly 2 GET /api/items request(s) with status 200.',
          outcome: 'passed',
        }),
      },
    }),
  ]);
  expect(result.conclusion.kind).toBe('regression');
  expect(result.conclusion.text).toContain(
    "The candidate's proposed version passed and sets no verdict.",
  );
  expect(journey?.base.checks).toEqual([
    expect.objectContaining({ outcome: 'passed', actual: 1 }),
  ]);
  expect(journey?.comparison).toMatchObject({ kind: 'available' });
  expect(
    journey?.comparison.kind === 'available' && journey.comparison.basis,
  ).not.toMatch(/protected/);
  expect(result.changeScope).toMatchObject({
    kind: 'recorded',
    recipe: {
      kind: 'changed',
      differences: [
        {
          check: requestCheck.id,
          change: 'altered',
          fields: [{ field: 'expectedCount', base: 1, candidate: 2 }],
        },
      ],
    },
  });

  // Without the base file, the captured definition judges, as before.
  const uncompared = await selectedComparison(bundles, undefined);

  expect(uncompared.conclusion.kind).toBe('no-regression');
  expect(uncompared.changeScope).toMatchObject({
    recipe: { kind: 'unavailable' },
  });
});

test('an altered check that the candidate meets under the base definition passes', async () => {
  const renamed = {
    ...requestCheck,
    name: 'Each Load items click sends one request',
  };
  const result = await judged({
    base: [requestCheck],
    captured: [renamed],
    baseCount: 1,
    candidateCount: 1,
  });

  expect(result.conclusion.kind).toBe('no-regression');
  expect(result.journeys[0].checks).toEqual([
    expect.objectContaining({
      name: requestCheck.name,
      verdict: 'passed',
      recipe: {
        change: 'altered',
        proposed: expect.objectContaining({ outcome: 'passed' }),
      },
    }),
  ]);
});

test('a removed check still reports its verdict under the base definition', async () => {
  const result = await judged({
    base: [requestCheck],
    captured: [],
    baseCount: 1,
    candidateCount: 2,
  });

  expect(result.journeys[0].checks).toEqual([
    expect.objectContaining({
      id: requestCheck.id,
      verdict: 'regression',
      recipe: { change: 'removed' },
    }),
  ]);
  expect(result.conclusion.kind).toBe('regression');
  expect(result.summary).toEqual({ passed: 0, total: 1 });
});

test('an added check has no baseline, so a failure is not a regression', async () => {
  for (const base of [[], 'unusable'] as const) {
    const result = await judged({
      base,
      captured: [requestCheck],
      baseCount: 1,
      candidateCount: 2,
    });
    const [journey] = result.journeys;

    expect(journey.checks).toEqual([
      expect.objectContaining({
        verdict: 'failed',
        recipe: { change: 'added' },
      }),
    ]);
    expect(result.conclusion.kind).toBe('check-failed');
    expect(journey.base.checks).toEqual([]);
  }
});

test('altered journey steps leave every check in the journey unknown', async () => {
  const result = await judged({
    base: [requestCheck],
    captured: [requestCheck],
    baseCount: 1,
    candidateCount: 1,
    baseFields: { steps: [{ kind: 'network-idle' }] },
  });

  expect(result.journeys[0].checks).toEqual([
    expect.objectContaining({
      verdict: 'unknown',
      recipe: {
        change: 'journey-altered',
        fields: ['steps'],
        proposed: expect.objectContaining({ outcome: 'passed' }),
      },
    }),
  ]);
  expect(result.conclusion.kind).toBe('unavailable');
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
        }),
      ],
    },
  ]);
  expect(result.journeys[0].checks).toEqual([
    expect.objectContaining({ verdict: 'passed' }),
  ]);
  expect(result.summary).toEqual({ passed: 1, total: 2 });
  expect(result.conclusion.kind).toBe('unavailable');
  expect(result.conclusion.text).toContain(
    'Reload items: this change removes the journey, so no capture ran its checks.',
  );
});
