import { Effect, Schema } from 'effect';
import { expect, test } from 'vitest';
import type { CheckDefinition } from './checks';
import { compareJourney, summarizeJourneys } from './compare';
import { json, sha256 } from './hash';
import { previewChecks, removedJourneys, type CompleteSide } from './judge';
import type { SavedJourney } from './journey';
import { inspectSide } from './read';
import type { Recipe } from './recipe';
import { sideSchema, type Comparison, type Side } from './result';
import { recipePlan } from './revisions';

// The reduced ASD-STE100 rules in docs/PRODUCT.md#writing, applied to the
// text the judge writes. Names, scopes and captured output are supplied data,
// so each counts as one word.
const instructionWords = 20;
const statementWords = 25;
const banned = [
  /\bverified\b/i,
  /\bverify\b/i,
  /\bsafe\b/i,
  /\bno issues\b/i,
  /\bissues? found\b/i,
  /\bsuspicious\b/i,
  /\bbroken\b/i,
  /\bAI detected\b/i,
];
const imperative =
  /^(Download|Run|Read|Open|Compare|Treat|Name|Fix|Give|Ask|Tell|Use|Follow|Write)\b/;

const evaluatedAt = '2026-09-27T15:34:04.958Z';
const visual = { kind: 'identical', width: 1280, height: 800 } as const;
const pageError =
  "TypeError: Cannot read properties of undefined (reading 'reading')\n    at hh (http://127.0.0.1:46429/assets/index-C6AMbicW.js:9:51704)";

const check = {
  kind: 'browser-errors',
  id: 'no-browser-errors',
  name: 'No browser errors',
  scope: 'One Reading click through completion and network idle.',
} as const satisfies CheckDefinition;

const recipe = {
  schemaVersion: 2,
  id: 'Open Reading shelf',
  name: 'Open Reading shelf',
  path: '/',
  ready: [{ kind: 'wait-text', text: 'Pick a shelf' }, { kind: 'network-idle' }],
  steps: [
    { kind: 'click-role', role: 'button', name: 'Reading' },
    { kind: 'wait-text', text: '2 books' },
    { kind: 'network-idle' },
  ],
  checks: [check],
  collectors: [{ kind: 'accessibility' }, { kind: 'timeline' }, { kind: 'browser-errors' }],
  viewport: { width: 1280, height: 800, scale: 1 },
  browserArguments: ['--no-sandbox'],
  maxAgeMs: 86_400_000,
} as const satisfies Recipe;

type ObservedSource = CompleteSide['capture']['manifest']['observed']['source'];

const gitSource = (commit: string, trackedChanges = false): ObservedSource => ({
  kind: 'git',
  commit,
  trackedChanges,
});

// One complete capture of the journey: the candidate's records a page error
// during the first step, and the base's records none.
function side({
  label,
  errors,
  source = gitSource('b'.repeat(40)),
  checks = [check],
}: {
  label: string;
  errors: readonly string[];
  source?: ObservedSource;
  checks?: readonly CheckDefinition[];
}): CompleteSide {
  const files = [{ path: 'src/App.jsx', sha256: 'e'.repeat(64), executable: false }];
  const decoded = Schema.decodeUnknownSync(sideSchema)({
    execution: 'complete',
    capture: {
      manifest: {
        schemaVersion: 5,
        kind: 'capture',
        id: `${label.toLowerCase()}-capture`,
        label,
        application: 'Reading list',
        source: {
          kind: 'snapshot',
          sha256: sha256(json({ entry: 'src/App.jsx', files })),
          entry: 'src/App.jsx',
          revision: { kind: 'commit', commit: '9'.repeat(40) },
          files,
        },
        recipe: { id: recipe.id, sha256: 'f'.repeat(64) },
        producer: { name: 'agent-browser', version: '0.38.1' },
        observed: { version: '0.1.0', source },
        conditions: {
          kind: 'recorded',
          value: {
            browser: 'Chrome 154.0.8037.57',
            platform: 'linux/x64',
            bun: '1.4.2',
            viewport: recipe.viewport,
            colorScheme: 'light',
            locale: 'en-US',
            timezone: 'UTC',
            inputsHash: 'a'.repeat(64),
            dependenciesHash: null,
          },
        },
        startedAt: '2026-09-27T15:19:18.763Z',
        finishedAt: '2026-09-27T15:19:37.850Z',
        execution: { kind: 'complete' },
        artifacts: [],
        evidence: [],
      },
      sha256: 'c'.repeat(64),
    },
    recipe: { ...recipe, checks },
    observations: {
      schemaVersion: 3,
      requests: [],
      browserErrors: errors,
      window: {
        startedAt: '2026-09-27T15:19:33.092Z',
        finishedAt: '2026-09-27T15:19:35.116Z',
      },
    },
    evidence: [
      {
        kind: 'browser-errors',
        status: 'recorded',
        value: {
          steps: recipe.steps.length,
          coverage: { kind: 'complete' },
          entries: errors.map((text) => ({
            source: 'page',
            text,
            step: 0,
            after: '2026-09-27T15:19:33.114Z',
            seenAt: '2026-09-27T15:19:33.248Z',
          })),
        },
      },
    ],
    screenshot: 'screenshot.png',
    checks: [],
    artifacts: [],
    unresolved: [],
  });

  if (decoded.execution !== 'complete') {
    throw new Error('The side is a complete capture');
  }

  return { ...decoded, checks: previewChecks(decoded) };
}

const base = side({ label: 'Base', errors: [] });
const candidate = side({ label: 'Candidate', errors: [pageError] });

function result(pair: { base: Side; candidate: Side }): Comparison {
  return summarizeJourneys({
    journeys: [compareJourney({ ...pair, evaluatedAt, visual })],
    evaluatedAt,
    mode: 'comparison',
  });
}

// The regression, the same journey passing, with no named check, with no
// base capture, and with captures that report differing Observed sources.
async function results(): Promise<Comparison[]> {
  const unchecked = { label: 'Base', errors: [], checks: [] };
  const missing = await Effect.runPromise(
    inspectSide({ directory: null, prefix: 'base', evaluatedAt }),
  );
  const pairs = [
    { base, candidate },
    { base, candidate: base },
    { base: side(unchecked), candidate: side(unchecked) },
    { base: missing, candidate },
    {
      base: side({ label: 'Base', errors: [], source: gitSource('1'.repeat(40), true) }),
      candidate: side({ label: 'Candidate', errors: [], source: gitSource('2'.repeat(40)) }),
    },
    {
      base: side({
        label: 'Base',
        errors: [],
        source: { kind: 'unavailable', reason: 'Observed was not run from a git checkout' },
      }),
      candidate: side({ label: 'Candidate', errors: [] }),
    },
    ...['Observed was not run from a git checkout', 'git is not installed'].map((reason) => ({
      base: side({
        label: 'Base',
        errors: [],
        source: { kind: 'unavailable', reason: 'Observed was not run from a git checkout' },
      }),
      candidate: side({ label: 'Candidate', errors: [], source: { kind: 'unavailable', reason } }),
    })),
  ];

  return [...pairs.map(result), ...recipeResults()];
}

// The journey judged against base observed.json files that alter its check,
// remove a check and a journey, alter its steps, or are unusable.
function recipeResults(): Comparison[] {
  const journey = (fields: Partial<SavedJourney> = {}): SavedJourney => ({
    name: recipe.name,
    path: recipe.path,
    ready: recipe.ready,
    steps: recipe.steps,
    checks: [check],
    collectors: recipe.collectors,
    viewport: recipe.viewport,
    browserArguments: recipe.browserArguments,
    maxAgeMs: recipe.maxAgeMs,
    ...fields,
  });
  const removedCheck = {
    kind: 'request-count',
    id: 'one-books-request',
    name: 'Each Reading click sends one books request',
    scope: 'One Reading click.',
    method: 'GET',
    path: '/api/books',
    expectedCount: 1,
    status: 200,
  } as const;
  const bases = [
    {
      kind: 'read',
      commit: 'c'.repeat(40),
      sha256: 'd'.repeat(64),
      journeys: [
        journey({
          checks: [{ ...check, scope: 'The first Reading click.' }, removedCheck],
        }),
        journey({ name: 'Close Reading shelf' }),
      ],
    },
    {
      kind: 'read',
      commit: 'c'.repeat(40),
      sha256: 'd'.repeat(64),
      journeys: [journey({ steps: [] })],
    },
    {
      kind: 'unusable',
      commit: 'c'.repeat(40),
      reason: 'The base revision has no observed.json.',
    },
    {
      kind: 'unavailable',
      reason: 'git could not read observed.json at the base revision',
    },
  ] as const;

  return bases.map((recipeBase) => {
    const plan = recipePlan({ base: recipeBase, candidate: [journey()] }, 'unused');

    return summarizeJourneys({
      journeys: [
        compareJourney({
          base,
          candidate,
          evaluatedAt,
          visual,
          judgement: plan.judge(recipe.name),
        }),
      ],
      evaluatedAt,
      mode: 'comparison',
      recipe: plan.scope,
      removedJourneys: removedJourneys(plan.removed),
    });
  });
}

function supplied(result: Comparison): string[] {
  return [
    ...result.removedJourneys.flatMap((journey) => [
      journey.journey,
      ...journey.checks.flatMap((item) => [item.name, item.scope]),
    ]),
    ...result.journeys.flatMap((journey) => [
      result.title,
      journey.title,
      ...journey.checks.flatMap((item) => [item.name, item.scope]),
      ...(journey.candidate.execution === 'complete' ? journey.candidate.evidence : []).flatMap(
        (view) =>
          view.kind === 'browser-errors' && view.status === 'recorded'
            ? view.value.entries.map((entry) => entry.text.split('\n')[0] ?? '')
            : [],
      ),
    ]),
  ];
}

// The sentences the judge writes into a result: run and journey conclusions,
// limitations, the comparison's basis or reasons, and each check's detail.
function written(result: Comparison): string[] {
  return [
    result.conclusion.text,
    ...result.journeys.flatMap((journey) => [
      journey.conclusion.text,
      ...journey.limitations,
      ...(journey.comparison.kind === 'available' ? [journey.comparison.basis] : []),
      ...(journey.comparison.kind === 'unavailable' ? journey.comparison.reasons : []),
      ...journey.checks.map((item) => item.detail),
    ]),
    ...result.removedJourneys.flatMap((journey) => journey.checks.map((item) => item.detail)),
  ];
}

function mask(text: string, data: string[]): string {
  return data
    .map((item) => item.trim().replace(/\.$/, ''))
    .filter((item) => item !== '')
    .sort((a, b) => b.length - a.length)
    .reduce(
      (current, item) =>
        current.replace(
          new RegExp(
            `(?<![\\p{L}\\d])${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\d])`,
            'gu',
          ),
          'DATA',
        ),
      text,
    );
}

type Sentence = { text: string; words: number; instruction: boolean };

function sentences(text: string, data: string[]): Sentence[] {
  return mask(text, data)
    .replace(/"[^"\n]*"/g, 'DATA')
    .split('\n')
    .flatMap((line) =>
      line
        .split(/(?<=[.!?;])\s+/)
        .map((part) => part.trim())
        .filter((part) => /\p{L}/u.test(part))
        .map((part) => ({
          text: part,
          words: part.split(/\s+/).filter((word) => /[\p{L}\d]/u.test(word)).length,
          instruction: imperative.test(part),
        })),
    );
}

async function texts(): Promise<{ name: string; text: string; data: string[] }[]> {
  return (await results()).flatMap((item) =>
    written(item).map((text) => ({
      name: item.conclusion.kind,
      text,
      data: supplied(item),
    })),
  );
}

test('generated text uses no banned status wording', async () => {
  const found = (await texts()).flatMap(({ name, text, data }) =>
    banned
      .filter((pattern) => pattern.test(mask(text, data)))
      .map((pattern) => `${name}: ${pattern.source}: ${text}`),
  );

  expect(found).toEqual([]);
});

test('generated sentences stay within the word limits', async () => {
  const long = (await texts()).flatMap(({ name, text, data }) =>
    sentences(text, data)
      .filter(
        (sentence) => sentence.words > (sentence.instruction ? instructionWords : statementWords),
      )
      .map((sentence) => `${name}: ${sentence.words} words: ${sentence.text}`),
  );

  expect(long).toEqual([]);
});
