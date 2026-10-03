import { Effect, Schema } from 'effect';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'vitest';
import { summarize } from '../scripts/github-action';
import { compareJourney, summarizeJourneys } from '../src/comparison';
import { comparisonSchema, type Comparison } from '../src/comparison-model';
import { renderComparison } from '../src/comparison-report';
import { json } from '../src/encoding';
import { inspectEvidence } from '../src/evidence';
import { escapeText } from '../src/markdown';
import { renderReport } from '../src/report';
import { parseManifest } from '../src/schema';
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
// Artifact integrity is a hash comparison, not a claim about the change.
const allowed = /integrity: verified/g;
const imperative =
  /^(Download|Run|Read|Open|Compare|Treat|Name|Fix|Give|Ask|Tell|Use|Follow)\b/;

const fixture = path.join(import.meta.dirname, 'fixtures');
const evaluatedAt = '2026-09-27T15:34:04.958Z';

async function errorsResult(): Promise<Comparison> {
  return Schema.decodeUnknownSync(Schema.fromJsonString(comparisonSchema))(
    await readFile(path.join(fixture, 'report/errors-result.json'), 'utf8'),
  );
}

// The fixture's regression, the same journey passing, and the same journey
// with no named check.
async function results(): Promise<Comparison[]> {
  const regression = await errorsResult();
  const [journey] = regression.journeys;

  if (journey === undefined || journey.base.execution !== 'complete') {
    throw new Error('The fixture holds one journey with a complete base');
  }

  const visual = { kind: 'identical', width: 1280, height: 800 } as const;
  const passing = compareJourney({
    base: journey.base,
    candidate: journey.base,
    evaluatedAt,
    visual,
  });
  const unchecked = (side: typeof journey.base) => ({
    ...side,
    checks: [],
    recipe: { ...side.recipe, checks: [] },
  });
  const notChecked = compareJourney({
    base: unchecked(journey.base),
    candidate: unchecked(journey.base),
    evaluatedAt,
    visual,
  });

  return [
    regression,
    ...[passing, notChecked].map((item) =>
      summarizeJourneys({ journeys: [item], evaluatedAt, mode: 'comparison' }),
    ),
  ];
}

function supplied(result: Comparison): string[] {
  return result.journeys.flatMap((journey) => [
    result.title,
    journey.title,
    ...journey.checks.flatMap((check) => [
      check.name,
      check.scope,
      check.expectation,
    ]),
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

function strings(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }

  return typeof value === 'object' && value !== null
    ? Object.values(value).flatMap(strings)
    : [];
}

type Sentence = { text: string; words: number; instruction: boolean };

function mask(text: string, data: string[]): string {
  return data
    .flatMap((item) => [item, escapeText(item)])
    .filter((item) => item.trim() !== '')
    .sort((a, b) => b.length - a.length)
    .reduce(
      (current, item) => current.replaceAll(item.replace(/\.$/, ''), 'DATA'),
      text,
    );
}

function sentences(text: string, data: string[]): Sentence[] {
  const masked = mask(text, data)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/^```.*$/gm, '')
    .replace(/`[^`\n]*`/g, 'CODE')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/"[^"\n]*"/g, 'DATA');
  let steps = false;

  return masked.split('\n').flatMap((line) => {
    if (/^#+ /.test(line)) {
      steps = /^#+ Next steps$/.test(line);
    }

    const content = line.replace(/^[\s>#*|-]*(\d+\.\s)?/, '');

    return content
      .split(/(?<=[.!?])\s+|\s·\s|\s\|\s/)
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

async function phase0Report(): Promise<string> {
  const directory = path.join(fixture, 'todomvc');
  const manifest = await Effect.runPromise(parseManifest(todomvc));

  return renderReport(
    await Effect.runPromise(inspectEvidence(manifest, directory)),
    directory,
  );
}

async function texts(): Promise<
  { name: string; text: string; data: string[] }[]
> {
  const rendered = (await results()).flatMap((result) => {
    const data = supplied(result);
    const kind = result.conclusion.kind;

    return [
      { name: `report.md (${kind})`, text: renderComparison(result), data },
      {
        name: `PR comment (${kind})`,
        text: summarize({
          output: json({ directory: '/bundle', result }),
          exitCode: kind === 'regression' ? 2 : 0,
          artifact: 'observed-bundle',
          page: null,
          surface: { kind: 'comment' },
        }).markdown,
        data,
      },
      { name: `handoff (${kind})`, text: agentText(result), data },
    ];
  });

  return [
    ...rendered,
    {
      name: 'Phase 0 report.md',
      text: await phase0Report(),
      data: strings(todomvc),
    },
  ];
}

test('generated text uses no banned status wording', async () => {
  const found = (await texts()).flatMap(({ name, text, data }) =>
    banned
      .filter((pattern) => pattern.test(mask(text, data).replace(allowed, '')))
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

function handoffs(result: Comparison): string[] {
  const comment = summarize({
    output: json({ directory: '/bundle', result }),
    exitCode: 2,
    artifact: 'observed-bundle',
    page: null,
    surface: { kind: 'comment' },
  }).markdown;
  const prompt = /```text\n([\s\S]*?)\n```/.exec(comment)?.[1];

  if (prompt === undefined) {
    throw new Error('The regression comment holds an agent prompt');
  }

  return [agentText(result), prompt];
}

test('agent handoffs list facts, then one instruction per next step', async () => {
  for (const text of handoffs(await errorsResult())) {
    const lines = text.split('\n');
    const facts = lines.findIndex((line) => /^#+ Facts$/.test(line));
    const steps = lines.findIndex((line) => /^#+ Next steps$/.test(line));

    expect(facts).toBeGreaterThanOrEqual(0);
    expect(steps).toBeGreaterThan(facts);

    const instructions = lines
      .slice(steps + 1)
      .filter((line) => line.trim() !== '');
    const verbs = new Set(
      instructions.map((line) => line.replace(/^- /, '').split(' ')[0]),
    );
    const factSentences = sentences(
      lines.slice(facts + 1, steps).join('\n'),
      [],
    );

    expect(instructions.length).toBeGreaterThan(0);

    for (const line of instructions) {
      expect(line).toMatch(/^- [A-Z]/);
      expect(sentences(line, [])).toHaveLength(1);
    }

    expect(
      factSentences.filter((sentence) =>
        verbs.has(sentence.text.split(' ')[0]),
      ),
    ).toEqual([]);
  }
});
