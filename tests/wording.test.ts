import { Effect, Schema } from 'effect';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'vitest';
import { summarize, type Surface } from '../scripts/github-action';
import {
  compareJourney,
  inspectSide,
  removedJourneys,
  summarizeJourneys,
} from '../src/comparison';
import { comparisonSchema, type Comparison } from '../src/comparison-model';
import { renderComparison } from '../src/comparison-report';
import { json } from '../src/encoding';
import { inspectEvidence } from '../src/evidence';
import { escapeText } from '../src/markdown';
import { renderReport } from '../src/report';
import { sideOutcome } from '../src/result-text';
import type { Journey as ProjectJourney } from '../src/project';
import { recipePlan } from '../src/recipe-diff';
import { parseManifest } from '../src/schema';
import { statusWords } from '../src/status-words';
import { agentText } from '../src/viewer/agent-text';
import todomvc from './fixtures/todomvc/manifest.json' with { type: 'json' };

// The reduced ASD-STE100 rules in docs/PRODUCT.md#writing, applied to the
// text Observed writes. Names, scopes and captured output are supplied data,
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
  /^(Download|Run|Read|Open|Compare|Treat|Name|Fix|Give|Ask|Tell|Use|Follow)\b/;

const fixture = path.join(import.meta.dirname, 'fixtures');
const evaluatedAt = '2026-09-27T15:34:04.958Z';
const exitCodes = {
  regression: 2,
  'check-failed': 2,
  unavailable: 1,
  'no-regression': 0,
  'not-checked': 0,
  preview: 0,
} satisfies Record<Comparison['conclusion']['kind'], number>;
const surfaces: Surface[] = [
  { kind: 'comment' },
  { kind: 'check' },
  { kind: 'job' },
];

async function errorsResult(): Promise<Comparison> {
  return Schema.decodeUnknownSync(Schema.fromJsonString(comparisonSchema))(
    await readFile(path.join(fixture, 'report/errors-result.json'), 'utf8'),
  );
}

async function fixtureJourney() {
  const [journey] = (await errorsResult()).journeys;

  if (
    journey?.base.execution !== 'complete' ||
    journey.candidate.execution !== 'complete'
  ) {
    throw new Error('The fixture holds one journey with complete captures');
  }

  return { journey, base: journey.base, candidate: journey.candidate };
}

// The fixture's regression, the same journey passing, with no named check,
// and with no base capture.
async function results(): Promise<Comparison[]> {
  const { base, candidate } = await fixtureJourney();
  const visual = { kind: 'identical', width: 1280, height: 800 } as const;
  const unchecked = {
    ...base,
    checks: [],
    recipe: { ...base.recipe, checks: [] },
  };
  const missing = await Effect.runPromise(
    inspectSide({ directory: null, prefix: 'base', evaluatedAt }),
  );
  const pairs = [
    { base, candidate },
    { base, candidate: base },
    { base: unchecked, candidate: unchecked },
    { base: missing, candidate },
  ];

  return [
    ...pairs.map((pair) =>
      summarizeJourneys({
        journeys: [compareJourney({ ...pair, evaluatedAt, visual })],
        evaluatedAt,
        mode: 'comparison',
      }),
    ),
    ...(await recipeResults()),
  ];
}

// The fixture journey judged against base observed.json files that alter
// its check, remove a check and a journey, alter its steps, or are unusable.
async function recipeResults(): Promise<Comparison[]> {
  const fixtureResult = await errorsResult();
  const { base, candidate } = await fixtureJourney();
  const { recipe } = candidate;
  const [check] = recipe.checks;
  const scope = fixtureResult.changeScope;
  const visual = { kind: 'identical', width: 1280, height: 800 } as const;

  if (check === undefined || scope.kind !== 'recorded') {
    throw new Error('The fixture has a check and a recorded change scope');
  }

  const journey = (fields: Partial<ProjectJourney> = {}): ProjectJourney => ({
    name: recipe.name,
    path: recipe.path,
    ready: recipe.ready,
    steps: recipe.steps,
    checks: recipe.checks,
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
          checks: [
            { ...check, scope: 'The first Reading click.' },
            removedCheck,
          ],
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
  ] as const;

  return bases.map((recipeBase) => {
    const plan = recipePlan(
      { base: recipeBase, candidate: [journey()] },
      'unused',
    );

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
      scope: { ...scope, recipe: plan.scope },
      removedJourneys: removedJourneys(plan.removed),
    });
  });
}

function supplied(result: Comparison): string[] {
  return [
    ...result.removedJourneys.flatMap((journey) => [
      journey.journey,
      ...journey.checks.flatMap((check) => [check.name, check.scope]),
    ]),
    ...suppliedByJourneys(result),
  ];
}

function suppliedByJourneys(result: Comparison): string[] {
  return result.journeys.flatMap((journey) => [
    result.title,
    journey.title,
    ...journey.checks.flatMap((check) => [check.name, check.scope]),
    ...(journey.candidate.execution === 'complete'
      ? journey.candidate.evidence
      : []
    ).flatMap((view) =>
      view.kind === 'browser-errors' && view.status === 'recorded'
        ? view.value.entries.map((entry) => entry.text.split('\n')[0] ?? '')
        : [],
    ),
  ]);
}

// Every multi-word string in the Phase 0 manifest was supplied by its author.
function phrases(value: unknown): string[] {
  if (typeof value === 'string') {
    return /\s/.test(value) ? [value] : [];
  }

  return typeof value === 'object' && value !== null
    ? Object.values(value).flatMap(phrases)
    : [];
}

function mask(text: string, data: string[]): string {
  return data
    .flatMap((item) => [item, escapeText(item)])
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
  const masked = mask(text, data)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/`[^`\n]*`/g, 'CODE')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/"[^"\n]*"/g, 'DATA');
  let steps = false;

  return masked.split('\n').flatMap((line) => {
    if (/^#+ /.test(line) || line.startsWith('```')) {
      steps = /^#+ Next steps$/.test(line);

      return [];
    }

    return line
      .replace(/^[\s>#*|-]*(\d+\.\s)?/, '')
      .split(/(?<=[.!?;])\s+|\s·\s|\s\|\s/)
      .map((part) => part.replace(/\*\*/g, '').trim())
      .filter((part) => /\p{L}/u.test(part))
      .map((part) => ({
        text: part,
        words: part.split(/\s+/).filter((word) => /[\p{L}\d]/u.test(word))
          .length,
        instruction: steps || imperative.test(part),
      }));
  });
}

async function phase0Reports(): Promise<string[]> {
  const directory = path.join(fixture, 'todomvc');
  const unhashed = {
    ...todomvc,
    artifacts: todomvc.artifacts.map(({ id, path, description }) => ({
      id,
      path,
      description,
    })),
  };

  return Promise.all(
    [todomvc, unhashed].map(async (input) =>
      renderReport(
        await Effect.runPromise(
          inspectEvidence(
            await Effect.runPromise(parseManifest(input)),
            directory,
          ),
        ),
        directory,
      ),
    ),
  );
}

function comment(result: Comparison, surface: Surface): string {
  return summarize({
    output: json({ directory: '/bundle', result }),
    exitCode: exitCodes[result.conclusion.kind],
    artifact: 'observed-bundle',
    page: null,
    surface,
  }).markdown;
}

async function texts(): Promise<
  { name: string; text: string; data: string[] }[]
> {
  const rendered = (await results()).flatMap((result) => {
    const data = supplied(result);
    const kind = result.conclusion.kind;

    return [
      { name: `report.md (${kind})`, text: renderComparison(result), data },
      ...surfaces.map((surface) => ({
        name: `${surface.kind} summary (${kind})`,
        text: comment(result, surface),
        data,
      })),
      { name: `handoff (${kind})`, text: agentText(result), data },
    ];
  });
  const untrusted = summarize({
    output: '{"result":{"conclusion":{"kind":"no-regression"}}}',
    exitCode: 0,
    artifact: 'observed-bundle',
    page: null,
    surface: { kind: 'comment' },
  }).markdown;

  return [
    ...rendered,
    { name: 'untrusted summary', text: untrusted, data: [] },
    ...(await phase0Reports()).map((text, index) => ({
      name: `Phase 0 report.md ${index}`,
      text,
      data: phrases(todomvc),
    })),
  ];
}

test('generated text uses no banned status wording', async () => {
  const found = (await texts()).flatMap(({ name, text, data }) =>
    banned
      .filter((pattern) => pattern.test(mask(text, data)))
      .map((pattern) => `${name}: ${pattern.source}`),
  );

  expect(found).toEqual([]);
});

test('generated sentences stay within the word limits', async () => {
  const long = (await texts()).flatMap(({ name, text, data }) =>
    sentences(text, data)
      .filter(
        (sentence) =>
          sentence.words >
          (sentence.instruction ? instructionWords : statementWords),
      )
      .map((sentence) => `${name}: ${sentence.words} words: ${sentence.text}`),
  );

  expect(long).toEqual([]);
});

test('agent handoffs list facts, then one instruction per next step', async () => {
  const result = await errorsResult();
  const prompt = /```text\n([\s\S]*?)\n```/.exec(
    comment(result, { kind: 'comment' }),
  )?.[1];

  if (prompt === undefined) {
    throw new Error('The regression comment holds an agent prompt');
  }

  for (const text of [agentText(result), prompt]) {
    const lines = text.split('\n');
    const facts = lines.findIndex((line) => /^#+ Facts$/.test(line));
    const steps = lines.findIndex((line) => /^#+ Next steps$/.test(line));
    const instructions = lines
      .slice(steps + 1)
      .filter((line) => line.trim() !== '');

    expect(facts).toBeGreaterThanOrEqual(0);
    expect(steps).toBeGreaterThan(facts);
    expect(instructions.length).toBeGreaterThan(0);

    for (const line of instructions) {
      expect(line).toMatch(/^- /);
      expect(sentences(line, [])).toEqual([
        expect.objectContaining({ instruction: true }),
      ]);
      expect(line.replace(/^- /, '')).toMatch(imperative);
    }

    expect(
      sentences(lines.slice(facts + 1, steps).join('\n'), supplied(result))
        .filter((sentence) => sentence.instruction)
        .map((sentence) => sentence.text),
    ).toEqual([]);
  }
});

test('a check one side lacks is unknown without a complete capture, and not run with one', async () => {
  const { journey, base } = await fixtureJourney();
  const [check] = journey.checks;
  const missing = await Effect.runPromise(
    inspectSide({ directory: null, prefix: 'base', evaluatedAt }),
  );

  if (check === undefined) {
    throw new Error('The fixture journey has a check');
  }

  expect(sideOutcome(missing, check.id)).toBe(statusWords.unknown.word);
  expect(sideOutcome({ ...base, checks: [] }, check.id)).toBe(
    statusWords.notRun.word,
  );
});

test('docs/PRODUCT.md lists every status word', async () => {
  const product = (
    await readFile(path.join(import.meta.dirname, '../docs/PRODUCT.md'), 'utf8')
  ).toLowerCase();
  const table = /\| dimension \| values \|\n[\s\S]*?\n\n/.exec(product)?.[0];
  const listed = new Set(
    (table ?? '')
      .split('\n')
      .flatMap((row) => row.split('|')[2]?.split(',') ?? [])
      .map((value) => value.trim().replace(/,.*$/, '')),
  );

  expect(
    Object.values(statusWords)
      .map(({ word }) => word.toLowerCase())
      .filter((word) => !listed.has(word)),
  ).toEqual([]);
});
