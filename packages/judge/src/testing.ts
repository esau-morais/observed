import { Effect, Schema } from 'effect';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sourceSchema, type Capture, type CaptureArtifact, type Observations } from './capture';
import { savedCheckSchema, type CheckDefinition } from './checks';
import { summarizeJourneys } from './compare';
import type { EvidenceValue } from './evidence';
import { json, sha256 } from './hash';
import type { SavedJourney } from './journey';
import type { Mode } from './judge';
import { encodeRgbPng } from './png';
import { inspectComparison, inspectSide } from './read';
import type { Recipe } from './recipe';
import {
  comparisonSchema,
  selectionSchemaVersion,
  type Journey,
  type Selection,
  type Visual,
} from './result';

// Synthetic capture bundles and recipes shared by the judge tests.

export const recipe = {
  schemaVersion: 2,
  id: 'items-once-v1',
  name: 'Load items',
  path: '/',
  ready: [{ kind: 'wait-text', text: 'Load items' }],
  steps: [
    { kind: 'click-role', role: 'button', name: 'Load items' },
    { kind: 'wait-text', text: 'Items loaded' },
    { kind: 'network-idle' },
  ],
  checks: [
    {
      kind: 'request-count',
      id: 'one-items-request',
      name: 'One request per load action',
      method: 'GET',
      path: '/api/items',
      expectedCount: 1,
      status: 200,
      scope: 'One Load items click through completion and network idle.',
    },
  ],
  collectors: [],
  viewport: { width: 1120, height: 800, scale: 1 },
  browserArguments: ['--no-sandbox'],
  maxAgeMs: 86_400_000,
} as const satisfies Recipe;

export const recipeText = json(recipe);
export const recipeHash = sha256(recipeText);
export const producer = { name: 'synthetic-tests', version: '1' };
export const observed = {
  version: '0.0.0-synthetic',
  source: { kind: 'git', commit: 'a'.repeat(40), trackedChanges: false },
} as const;
export const fixtureHash = sha256('synthetic test inputs');

export const [requestCheck] = recipe.checks;

export const evaluatedAt = '2026-09-23T12:00:00.000Z';
export const whitePng = encodeRgbPng(4, 4, new Uint8Array(4 * 4 * 3).fill(255));
export const pixelsNotInspected: Visual = {
  kind: 'unavailable',
  reason: 'Synthetic sides without screenshot pixels',
};

const directories: string[] = [];

export async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));

  directories.push(directory);

  return directory;
}

// Call from afterEach in every file that writes bundles.
export async function removeTemporaryDirectories(): Promise<void> {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
}

export function single(journey: Journey, mode: Mode = 'comparison') {
  return summarizeJourneys({ journeys: [journey], evaluatedAt, mode });
}

export function syntheticObservations(count = 1): Observations {
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

export async function saveManifest(directory: string, capture: unknown): Promise<void> {
  await writeFile(path.join(directory, 'capture.json'), json(capture));
}

export async function syntheticBundle(
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
  const directory = await temporaryDirectory('observed-comparison-test-');

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
  const evidenceFile = (kind: string, value: unknown) => ({
    id: `evidence-${kind}`,
    path: `evidence/${kind}.json`,
    text: json({ kind, schemaVersion: 1, value }),
  });

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
    ...(options.text === undefined ? [] : [evidenceFile('text', options.text)]),
    ...(options.performance === undefined
      ? []
      : [evidenceFile('performance', options.performance)]),
    ...(options.browserErrors === undefined
      ? []
      : [evidenceFile('browser-errors', options.browserErrors)]),
    ...(options.playwright === undefined ? [] : [evidenceFile('playwright', options.playwright)]),
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

export type Bundle = Awaited<ReturnType<typeof syntheticBundle>>;

export async function replaceArtifact(bundle: Bundle, id: string, content: string): Promise<void> {
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

export function inspect(directory: string | null, at = evaluatedAt) {
  return Effect.runPromise(inspectSide({ directory, prefix: 'candidate', evaluatedAt: at }));
}

export async function completeSide(contract: Recipe, text?: EvidenceValue<'text'>) {
  const side = await inspect(
    (await syntheticBundle({ contract, ...(text === undefined ? {} : { text }) })).directory,
  );

  if (side.execution !== 'complete') {
    throw new Error('A complete synthetic side is expected');
  }

  return side;
}

// A journey as observed.json writes it, from the synthetic recipe.
export function projectJourney(
  checks: readonly CheckDefinition[],
  fields: Partial<SavedJourney> = {},
): SavedJourney {
  return {
    name: recipe.name,
    path: recipe.path,
    ready: recipe.ready,
    steps: recipe.steps,
    checks: Schema.decodeUnknownSync(Schema.Array(savedCheckSchema))(checks),
    viewport: recipe.viewport,
    browserArguments: recipe.browserArguments,
    maxAgeMs: recipe.maxAgeMs,
    ...fields,
  };
}

export const allowsTwo = { ...requestCheck, expectedCount: 2 };

export async function judgedSides(options: {
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

// Compares the bundles as `observe` selects them, with both observed.json
// files when given.
export async function selectedComparison(
  bundles: Awaited<ReturnType<typeof judgedSides>>,
  recipes: Selection['recipes'],
) {
  const root = await temporaryDirectory('observed-recipe-');
  await mkdir(path.join(root, 'journey-1'));
  await symlink(bundles.base.directory, path.join(root, 'journey-1/base'));
  await symlink(bundles.candidate.directory, path.join(root, 'journey-1/candidate'));

  const { result } = await Effect.runPromise(
    inspectComparison({
      root,
      selection: {
        schemaVersion: selectionSchemaVersion,
        evaluatedAt,
        mode: 'comparison',
        journeys: [{ directory: 'journey-1', base: null, candidate: null }],
        ...(recipes === undefined ? {} : { recipes }),
      },
    }),
  );

  return Schema.decodeUnknownSync(comparisonSchema)(JSON.parse(json(result)));
}

export const withPlaywright: Recipe = {
  ...recipe,
  checks: [],
  collectors: [{ kind: 'playwright', command: ['npx', 'playwright', 'test'] }],
};

type PlaywrightTest = EvidenceValue<'playwright'>['tests'][number];

export function playwrightTest(
  title: string,
  outcome: PlaywrightTest['outcome'],
  fields: Partial<Omit<PlaywrightTest, 'id' | 'outcome'>> = {},
): PlaywrightTest {
  const test: Omit<PlaywrightTest, 'id'> = {
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
    ...fields,
  };

  return {
    id: [test.project, test.file, ...test.titlePath].join(' › '),
    ...test,
  };
}

export function playwrightRun(tests: PlaywrightTest[]): EvidenceValue<'playwright'> {
  const count = (outcome: string) => tests.filter((test) => test.outcome === outcome).length;

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
