import { Effect, Schema } from 'effect';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { checkKinds, type CheckDefinition } from './checks';
import { browserErrors } from './checks/browser-errors';
import { defineCheck, perSide, type CheckInput } from './checks/define';
import { compareJourney, summarizeJourneys } from './compare';
import type { EvidenceValue } from './evidence';
import { json } from './hash';
import type { SavedJourney } from './journey';
import { evaluateCheck } from './judge';
import { inspectSide } from './read';
import type { Recipe } from './recipe';
import { comparisonSchema, journeySchema, type RecipeSources } from './result';
import { recipePlan, type JourneyJudgement } from './revisions';
import {
  allowsTwo,
  completeSide,
  evaluatedAt,
  inspect,
  observed,
  pixelsNotInspected,
  playwrightRun,
  playwrightTest,
  projectJourney,
  recipe,
  removeTemporaryDirectories,
  requestCheck,
  saveManifest,
  single,
  judgedSides,
  syntheticBundle,
  withPlaywright,
} from './testing';

afterEach(removeTemporaryDirectories);

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
      artifacts: [{ id: 'screenshot', description: 'Image', integrity: 'verified' }],
    },
    {
      ...result.candidate,
      artifacts: [{ id: 'screenshot', description: 'Image', integrity: 'unavailable' }],
    },
  ]) {
    expect(decode({ ...result, candidate })._tag).toBe('Failure');
  }
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

  await writeFile(path.join(bundle.directory, 'images/after #1.png'), 'corrupt');
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
      { passed: 'preview', failed: 'check-failed', unknown: 'unavailable' }[expected],
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
    expected: [`from different commits (base ${'a'.repeat(40)}, candidate ${'c'.repeat(40)})`],
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
    artifacts: bundle.capture.artifacts.filter((artifact) => !written.has(artifact.id)),
  });

  return inspect(bundle.directory);
}

test('a failed capture is one reason, and a base failing the same way is named once, never passed', async () => {
  const stale = 'Setup step 2 of 2 (sh) exited with code 1: fixture is stale';
  const base = await failedSide(stale);
  const candidate = await failedSide(stale);

  expect(candidate.execution).toBe('capture-failed');
  expect(candidate.unresolved).toEqual([`Capture failed (application): ${stale}`]);

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
  expect(journey.checks.every((check) => check.verdict === 'unknown')).toBe(true);

  const differs = compareJourney({
    visual: pixelsNotInspected,
    base: await failedSide('Setup step 1 of 2 (bun) exited with code 1: x'),
    candidate,
    evaluatedAt,
  });

  expect(differs.comparison).toMatchObject({
    reasons: [
      expect.stringMatching(/^Base unavailable: /) as unknown,
      expect.stringMatching(/^Candidate unavailable: /) as unknown,
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
    const [before, after] = await Promise.all(
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
      expect(result.conclusion.text).toContain('Element text evidence unavailable');
    }
  },
);

test('a regression in any journey decides the run and names that journey', async () => {
  const side = async (count: number, id: string) =>
    inspect((await syntheticBundle({ count, contract: { ...recipe, id, name: id } })).directory);
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
  expect(Schema.decodeUnknownSync(comparisonSchema)(JSON.parse(json(result)))).toEqual(result);
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
      entry.status === 'recorded' ? { ...entry, conditions: { samples: 3 } } : entry,
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
    reasons: ['text evidence was recorded under different versions or conditions'],
  });
  expect(result.conclusion.kind).toBe('unavailable');
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
    const value = (input: CheckInput<'text'>) => input.evidence.text.elements[0]?.value ?? null;

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

test('a check that compares sides is unknown without a usable, comparable base', async () => {
  const candidate = await completeSide(twoChecks, statusText('Saved'));
  const cases = [
    {
      base: await completeSide(twoChecks),
      comparable: true,
      detail: 'Base: Element text evidence unavailable',
    },
    {
      base: await completeSide(twoChecks, statusText('Saved')),
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
      base: await completeSide(twoChecks, statusText('Pending')),
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
  const candidate = await completeSide(twoChecks, two);
  const pair = (base: Awaited<ReturnType<typeof completeSide>>) =>
    evaluateCheck(newValues, probe, {
      base,
      candidate,
      mode: 'comparison',
      comparable: true,
    });

  expect(pair(await completeSide(twoChecks, statusText('Saved')))).toMatchObject({
    base: { outcome: 'failed' },
    candidate: { outcome: 'failed' },
    regression: 'The candidate shows a value the base did not.',
  });
  expect(pair(await completeSide(twoChecks, two)).regression).toBeNull();
  expect(pair(await completeSide(twoChecks))).toMatchObject({
    candidate: { outcome: 'unknown' },
    regression: null,
  });
});

const performanceBudget = Schema.decodeUnknownSync(checkKinds.performance.definition)({
  kind: 'performance',
  id: 'lcp-budget',
  name: 'Largest contentful paint budget',
  scope: 'Open the page through the journey.',
  metric: 'lcp',
  max: 200,
});

// One warm-up run, then five measured runs of the same document, as the
// legacy fixtures base.json and slow-document.json recorded them.
function performanceRun(lcp: readonly number[]): EvidenceValue<'performance'> {
  const samples = lcp.map((value, index) => ({
    run: index + 1,
    warmup: index === 0,
    startedAt: `2026-09-27T05:08:${String(10 + index * 3).padStart(2, '0')}.000Z`,
    finishedAt: `2026-09-27T05:08:${String(12 + index * 3).padStart(2, '0')}.000Z`,
    document: '/',
    interactions: 1,
    metrics: {
      lcp: value,
      fcp: value,
      ttfb: 4,
      cls: 0,
      inp: 16,
      'dom-content-loaded': 18,
      load: 19,
    },
  }));
  const [first, ...rest] = samples;

  if (first === undefined) {
    throw new Error('A performance run has samples');
  }

  return {
    conditions: {
      samples: rest.length,
      warmup: 1,
      cpu: 'unthrottled',
      network: 'unthrottled',
      cache: 'warm',
      order: 'sequential',
      viewport: { width: 1280, height: 800, scale: 1 },
    },
    samples: [first, ...rest],
    inspection: { kind: 'not-requested' },
  };
}

const fastRun = performanceRun([64, 28, 40, 28, 32, 32]);
const slowRun = performanceRun([452, 440, 428, 428, 432, 428]);

async function performanceSide(performance: EvidenceValue<'performance'>) {
  const side = await inspect(
    (await syntheticBundle({ contract: twoChecks, performance })).directory,
  );

  if (side.execution !== 'complete') {
    throw new Error('A complete synthetic side is expected');
  }

  return side;
}

test('an absolute performance budget still fails the candidate when the base is unusable', async () => {
  const candidate = await performanceSide(slowRun);

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
  const candidate = await performanceSide(slowRun);

  expect(
    evaluateCheck(checkKinds.performance, definition, {
      base: await performanceSide(fastRun),
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

const specFile = (content: string) => [
  { path: 'e2e/cart.spec.ts', content },
  {
    path: 'main.ts',
    content: 'Synthetic source fixture, not an application.\n',
  },
];

type PlaywrightTest = EvidenceValue<'playwright'>['tests'][number];

async function playwrightJourney(options: {
  base: PlaywrightTest[];
  candidate: PlaywrightTest[];
  candidateSpec?: string;
  judgement?: JourneyJudgement;
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
    ...(options.judgement === undefined ? {} : { judgement: options.judgement }),
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
    }) as unknown,
  ]);
  expect(result.checks[0]?.recipe).toBeUndefined();
  expect(result.conclusion.kind).toBe('regression');
});

test('an imported test whose file changed carries the label, and its failure is not a regression', async () => {
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
  expect(result.checks[0]?.recipe).toEqual({ change: 'test-file-changed' });

  const passing = await playwrightJourney({
    base: [playwrightTest('adds an item', 'expected')],
    candidate: [playwrightTest('adds an item', 'expected')],
    candidateSpec: 'test("adds two items")\n',
  });

  expect(passing.checks).toEqual([
    expect.objectContaining({
      verdict: 'passed',
      recipe: { change: 'test-file-changed' },
    }) as unknown,
  ]);
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
    }) as unknown,
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

test('a large imported suite counts its passing tests and keeps the conclusion short', async () => {
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
  expect(result.conclusion.text.length).toBeLessThan(2000);
});

// The seeded run the legacy fixtures/playwright reports recorded: the same
// spec file on both sides, five tests with one retry.
function shelvesTest(
  title: string,
  line: number,
  outcome: PlaywrightTest['outcome'],
  statuses: readonly ('passed' | 'failed' | 'skipped')[],
): PlaywrightTest {
  return playwrightTest(title, outcome, {
    file: 'shelves.spec.js',
    source: 'e2e/shelves.spec.js',
    line,
    titlePath: ['shelves', title],
    expectedStatus: outcome === 'skipped' ? 'skipped' : 'passed',
    annotations: outcome === 'skipped' ? [{ type: 'skip', description: null }] : [],
    results: statuses.map((status, retry) => ({
      retry,
      status,
      duration: 10,
      startedAt: '2026-09-23T11:59:57.000Z',
      error: status === 'failed' ? 'Error: expect(locator).toHaveAttribute' : null,
      attachments: [],
    })),
  });
}

test('the seeded Playwright run compares to one regression, with flaky and skipped tests unknown', async () => {
  const spec = 'the trial app spec, identical on both sides\n';
  const files = [
    { path: 'e2e/shelves.spec.js', content: spec },
    { path: 'main.ts', content: 'Synthetic source fixture.\n' },
  ];
  const run = (finished: PlaywrightTest) =>
    playwrightRun([
      shelvesTest('starts with no shelf selected', 4, 'expected', ['passed']),
      shelvesTest('opens the Reading shelf', 10, 'expected', ['passed']),
      finished,
      shelvesTest('exports the shelf as CSV', 24, 'skipped', ['skipped']),
      shelvesTest('keeps the count after a second click', 28, 'flaky', ['failed', 'passed']),
    ]);
  const base = await syntheticBundle({
    contract: withPlaywright,
    playwright: run(shelvesTest('opens the Finished shelf', 17, 'expected', ['passed'])),
    files,
  });
  const candidate = await syntheticBundle({
    contract: withPlaywright,
    playwright: run(
      shelvesTest('opens the Finished shelf', 17, 'unexpected', ['failed', 'failed']),
    ),
    files,
  });
  const result = compareJourney({
    visual: pixelsNotInspected,
    base: await inspect(base.directory),
    candidate: await inspect(candidate.directory),
    evaluatedAt,
  });

  expect(Object.fromEntries(result.checks.map((check) => [check.name, check.verdict]))).toEqual({
    'shelves › starts with no shelf selected': 'passed',
    'shelves › opens the Reading shelf': 'passed',
    'shelves › opens the Finished shelf': 'regression',
    'shelves › exports the shelf as CSV': 'unknown',
    'shelves › keeps the count after a second click': 'unknown',
  });
  expect(result.conclusion.kind).toBe('regression');
});

async function judged(options: {
  base: readonly CheckDefinition[] | 'unusable' | 'unreadable';
  captured: readonly CheckDefinition[];
  baseCount: number;
  candidateCount: number;
  baseFields?: Partial<SavedJourney>;
}) {
  const bundles = await judgedSides(options);
  const sources: Record<'unreadable' | 'unusable', RecipeSources['base']> = {
    unreadable: { kind: 'unavailable', reason: 'Git failed.' },
    unusable: {
      kind: 'unusable',
      commit: 'c'.repeat(40),
      reason: 'The base revision has no observed.json.',
    },
  };
  const plan = recipePlan(
    {
      base:
        typeof options.base === 'string'
          ? sources[options.base]
          : {
              kind: 'read',
              commit: 'c'.repeat(40),
              sha256: 'd'.repeat(64),
              journeys: [projectJourney(options.base, options.baseFields)],
            },
      candidate: [projectJourney(options.captured)],
    },
    'unused',
  );

  return summarizeJourneys({
    journeys: [
      compareJourney({
        base: await Effect.runPromise(
          inspectSide({ directory: bundles.base.directory, prefix: 'base', evaluatedAt }),
        ),
        candidate: await inspect(bundles.candidate.directory),
        evaluatedAt,
        visual: pixelsNotInspected,
        judgement: plan.judge(recipe.name),
      }),
    ],
    evaluatedAt,
    mode: 'comparison',
    recipe: plan.scope,
  });
}

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
  expect(result.journeys[0].checks).toMatchObject([
    {
      name: requestCheck.name,
      verdict: 'passed',
      recipe: {
        change: 'altered',
        proposed: { outcome: 'passed' },
      },
    },
  ]);
});

test('a removed check still reports its verdict under the base definition', async () => {
  const result = await judged({
    base: [requestCheck],
    captured: [],
    baseCount: 1,
    candidateCount: 2,
  });

  expect(result.journeys[0].checks).toMatchObject([
    {
      id: requestCheck.id,
      verdict: 'regression',
      recipe: { change: 'removed' },
    },
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
      }) as unknown,
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

  expect(result.journeys[0].checks).toMatchObject([
    {
      verdict: 'unknown',
      recipe: {
        change: 'journey-altered',
        fields: ['steps'],
        proposed: { outcome: 'passed' },
      },
    },
  ]);
  expect(result.conclusion.kind).toBe('unavailable');
});

test('an unreadable base file leaves every check unknown, never judged by the candidate', async () => {
  const result = await judged({
    base: 'unreadable',
    captured: [allowsTwo],
    baseCount: 1,
    candidateCount: 2,
  });

  expect(result.journeys[0].checks).toMatchObject([{ verdict: 'unknown' }]);
  expect(result.journeys[0].checks[0]?.detail).toContain('Git failed.');
  expect(result.conclusion.kind).toBe('unavailable');
});

test('imported tests in a journey whose collectors changed are unknown', async () => {
  const playwright = (command: readonly [string, ...string[]]) => ({
    collectors: [{ kind: 'playwright' as const, command }],
  });
  const plan = recipePlan(
    {
      base: {
        kind: 'read',
        commit: 'c'.repeat(40),
        sha256: 'd'.repeat(64),
        journeys: [projectJourney([], playwright(['npx', 'playwright', 'test']))],
      },
      candidate: [
        projectJourney([], playwright(['npx', 'playwright', 'test', '--grep-invert', 'checkout'])),
      ],
    },
    'unused',
  );
  const result = await playwrightJourney({
    base: [playwrightTest('adds an item', 'expected')],
    candidate: [playwrightTest('adds an item', 'expected')],
    judgement: plan.judge(recipe.name),
  });

  expect(result.checks).toMatchObject([
    {
      verdict: 'unknown',
      recipe: {
        change: 'journey-altered',
        fields: ['collectors'],
        proposed: { outcome: 'passed' },
      },
    },
  ]);
  expect(result.conclusion.kind).toBe('unavailable');
});

test('imported tests are unknown when the base file could not be read', async () => {
  const result = await playwrightJourney({
    base: [playwrightTest('adds an item', 'expected')],
    candidate: [playwrightTest('adds an item', 'expected')],
    judgement: { kind: 'unreadable', reason: 'Git failed.' },
  });

  expect(result.checks).toMatchObject([{ verdict: 'unknown' }]);
  expect(result.checks[0]?.detail).toContain('Git failed.');
});
