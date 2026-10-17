import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { checkRun, select, type Expectation } from './check';
import { pairs } from './cases';
import { decodePng } from './png';
import { decodePng as decodeComparatorPng, encodeRgbPng } from '../../packages/judge/src/png';
import { evidencePairs } from './evidence-cases';
import { browserPairs } from './browser-cases';
import { checkRequestFault } from './fault-check';
import { detectedFault, seededFaults } from './fault-cases';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

const expected = {
  id: 'checker-faults',
  gate: 8,
  reason: 'A forged result cannot pass the independent checker.',
  exitCode: 2,
  assertions: [
    {
      label: 'verdict',
      actual: {
        kind: 'json',
        file: 'result.json',
        path: ['conclusion', 'kind'],
      },
      expected: 'regression',
    },
    {
      label: 'request count',
      actual: { kind: 'json', file: 'result.json', path: ['actual'] },
      expected: 2,
      raw: {
        kind: 'requests',
        file: 'requests.har',
        method: 'GET',
        pathname: '/api/items',
        status: 200,
      },
    },
  ],
} satisfies Expectation;

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'observed-gate-checker-'));
  roots.push(root);
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify({ conclusion: { kind: 'regression' }, actual: 2 }),
  );
  await writeFile(
    path.join(root, 'requests.har'),
    JSON.stringify({
      log: {
        entries: [0, 1].map(() => ({
          request: { method: 'GET', url: 'http://localhost:4567/api/items' },
          response: { status: 200 },
        })),
      },
    }),
  );

  return root;
}

test('does not credit a detected fault when required raw evidence is also broken', async () => {
  const root = await fixture();
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify({ conclusion: { kind: 'no-regression' }, actual: 2 }),
  );
  const required = ['verdict: expected "regression", received "no-regression"'];
  expect(detectedFault((await checkRun(root, expected, 2)).failures, required)).toBe(true);

  for (const raw of ['not JSON', '{}', '{"log":{"entries":[]}}']) {
    await writeFile(path.join(root, 'requests.har'), raw);
    expect(detectedFault((await checkRun(root, expected, 2)).failures, required)).toBe(false);
  }

  await rm(path.join(root, 'requests.har'));
  expect(detectedFault((await checkRun(root, expected, 2)).failures, required)).toBe(false);
});

test('request mutation classification retains pinned revision controls', async () => {
  const root = await fixture();
  const report = path.join(root, 'run');
  for (const [side, count] of [
    ['base', 1],
    ['candidate', 2],
  ] as const) {
    const capture = path.join(report, 'journey-1', side);
    await mkdir(capture, { recursive: true });
    await writeFile(
      path.join(capture, 'requests.har'),
      JSON.stringify({
        log: {
          entries: Array.from({ length: count }, () => ({
            request: { method: 'GET', url: 'http://localhost/api/items' },
            response: { status: 200 },
          })),
        },
      }),
    );
  }

  await writeFile(
    path.join(report, 'result.json'),
    JSON.stringify({
      conclusion: { kind: 'no-regression' },
      revision: 'pinned-base',
      journeys: [
        {
          checks: [
            { id: 'one-request', verdict: 'passed' },
            { id: 'loaded-text', verdict: 'passed' },
          ],
          base: {
            execution: 'complete',
            evidence: [{ kind: 'text', status: 'recorded' }],
            checks: [
              { id: 'one-request', actual: 1, outcome: 'passed' },
              { id: 'loaded-text', outcome: 'passed' },
            ],
          },
          candidate: {
            execution: 'complete',
            evidence: [{ kind: 'text', status: 'recorded' }],
            checks: [
              { id: 'one-request', actual: 2, outcome: 'failed' },
              { id: 'loaded-text', outcome: 'passed' },
            ],
          },
        },
      ],
    }),
  );
  const pair = pairs.find((item) => item.expectation.id === 'request-fault');
  const fault = seededFaults.find((item) => item.id === 'regression-as-passed');
  if (pair === undefined || fault === undefined) {
    throw new Error('Missing request fault');
  }

  const expectation: Expectation = {
    ...pair.expectation,
    assertions: [
      ...pair.expectation.assertions,
      {
        label: 'base pinned revision',
        actual: { kind: 'json', file: 'result.json', path: ['revision'] },
        expected: 'pinned-base',
        raw: { kind: 'json', file: 'identity.json', path: ['revision'] },
      },
    ],
  };
  await writeFile(path.join(root, 'expected.json'), JSON.stringify(expectation));
  const identity = path.join(report, 'identity.json');
  await writeFile(identity, JSON.stringify({ revision: 'pinned-base' }));
  const valid = await checkRequestFault(root, 0);
  expect(valid.raw.passed).toBe(true);
  expect(detectedFault(valid.result.failures, fault.requiredFailures)).toBe(true);

  for (const broken of [JSON.stringify({ revision: 'wrong-base' }), '{}', 'not JSON', null]) {
    if (broken === null) {
      await rm(identity);
    } else {
      await writeFile(identity, broken);
    }

    const checked = await checkRequestFault(root, 0);
    expect(checked.raw.passed).toBe(false);
    expect(detectedFault(checked.result.failures, fault.requiredFailures)).toBe(false);
  }
});

test('rejects a forged pass, wrong measurement, and wrong CLI exit independently', async () => {
  const root = await fixture();
  expect((await checkRun(root, expected, 2)).passed).toBe(true);

  for (const result of [
    { conclusion: { kind: 'no-regression' }, actual: 2 },
    { conclusion: { kind: 'regression' }, actual: 1 },
  ]) {
    await writeFile(path.join(root, 'result.json'), JSON.stringify(result));
    expect((await checkRun(root, expected, 2)).passed).toBe(false);
  }

  expect((await checkRun(await fixture(), expected, 0)).passed).toBe(false);
});

test('rejects missing, malformed, or disagreeing raw output even when the result is correct', async () => {
  const root = await fixture();

  for (const raw of ['not JSON', '{}', '{"log":{"entries":[]}}']) {
    await writeFile(path.join(root, 'requests.har'), raw);
    expect((await checkRun(root, expected, 2)).passed).toBe(false);
  }

  await rm(path.join(root, 'requests.har'));
  expect((await checkRun(root, expected, 2)).passed).toBe(false);
});

test('refuses raw artifacts that escape the bundle through a symlink', async () => {
  const root = await fixture();
  const other = await fixture();
  await rm(path.join(root, 'requests.har'));
  await symlink(path.join(other, 'requests.har'), path.join(root, 'requests.har'));

  expect((await checkRun(root, expected, 2)).failures.join(' ')).toContain('outside the run');
});

test('does not silently choose a duplicate check or treat a missing field as null', () => {
  expect(() =>
    select({ checks: [{ id: 'one' }, { id: 'one' }] }, ['checks', { key: 'id', equals: 'one' }]),
  ).toThrow('found 2');
  expect(() => select({}, ['missing'])).toThrow('Missing field');
});

test('fault expectations reject retained measurements on unknown or not-run sides', async () => {
  const root = await fixture();
  const checks = [
    { pair: 'request-fault', id: 'one-request', kind: null },
    { pair: 'text-fault', id: 'loaded-text', kind: 'text' },
    { pair: 'performance-fault', id: 'saved-load', kind: 'performance' },
    { pair: 'api-status-fault', id: 'saved-api', kind: 'api' },
    {
      pair: 'browser-errors-fault',
      id: 'saved-errors',
      kind: 'browser-errors',
    },
    {
      pair: 'accessibility-fault',
      id: 'saved-accessibility',
      kind: 'accessibility',
    },
    { pair: 'react-renders-fault', id: 'saved-renders', kind: 'react' },
    {
      pair: 'playwright-fault',
      id: 'playwright: saved.spec.ts › loaded items are saved',
      kind: 'playwright',
    },
  ];
  for (const fault of checks) {
    const pair = [...pairs, ...evidencePairs, ...browserPairs].find(
      (item) => item.expectation.id === fault.pair,
    );
    if (pair === undefined) {
      throw new Error('Missing fault pair');
    }

    const assertions = pair.expectation.assertions.filter((assertion) => {
      if (assertion.actual.kind !== 'json') {
        return false;
      }

      const field = assertion.actual.path.at(-1);

      return typeof field === 'string' && ['execution', 'outcome', 'status'].includes(field);
    });
    const [first, ...rest] = assertions;
    expect.soft(first, fault.pair).toBeDefined();
    if (first === undefined) {
      continue;
    }

    const expected = {
      ...pair.expectation,
      assertions: [first, ...rest],
    } satisfies Expectation;
    const side = (candidate: boolean) => ({
      execution: 'complete',
      checks: [...new Set(['one-request', 'loaded-text', fault.id])].map((id) => ({
        id,
        outcome: candidate && id === fault.id ? 'failed' : 'passed',
        actual: 1,
      })),
      evidence: [...new Set(['text', ...(fault.kind === null ? [] : [fault.kind])])].map(
        (kind) => ({
          kind,
          status: 'recorded',
          value: { retained: true },
        }),
      ),
    });
    const base = side(false);
    const candidate = side(true);
    const check = async (sides: { base: typeof base; candidate: typeof candidate }) => {
      await writeFile(path.join(root, 'result.json'), JSON.stringify({ journeys: [sides] }));

      return (await checkRun(root, expected, 2)).passed;
    };

    expect(await check({ base, candidate })).toBe(true);
    for (const name of ['base', 'candidate'] as const) {
      for (const mutation of ['unknown', 'not-run', 'inverted', 'execution', 'evidence']) {
        if (mutation === 'evidence' && fault.kind === null) {
          continue;
        }

        const changed = structuredClone({ base, candidate });
        const selected = changed[name];
        const measured = selected.checks.find((item) => item.id === fault.id);
        if (measured === undefined) {
          throw new Error('Missing measured check');
        }

        if (mutation === 'execution') {
          selected.execution = 'unknown';
        } else if (mutation === 'evidence') {
          const evidence = selected.evidence.find((item) => item.kind === fault.kind);
          if (evidence === undefined) {
            throw new Error('Missing evidence');
          }

          evidence.status = 'unavailable';
        } else {
          const inverted = name === 'base' ? 'failed' : 'passed';
          measured.outcome = mutation === 'inverted' ? inverted : mutation;
        }

        expect.soft(await check(changed), `${fault.pair} ${name} ${mutation}`).toBe(false);
      }
    }
  }
});

test.each([
  ['relaxed-check', 1, 2],
  ['removed-check', 1, 2],
  ['rewritten-journey', 0, 2],
  ['removed-journey', 2, 4],
] as const)('%s rejects inflated pass counts and missing checks', async (id, passed, total) => {
  const pair = pairs.find((item) => item.expectation.id === id);
  if (pair === undefined) {
    throw new Error('Missing altered-expectation pair');
  }

  const [first, ...rest] = pair.expectation.assertions.filter(
    ({ actual }) =>
      actual.kind === 'json' &&
      actual.file === 'result.json' &&
      (actual.path[0] === 'conclusion' || actual.path[0] === 'summary'),
  );
  if (first === undefined) {
    throw new Error('Missing result assertions');
  }

  const root = await fixture();
  const expected = {
    ...pair.expectation,
    assertions: [first, ...rest],
  } satisfies Expectation;
  const conclusion = id.endsWith('journey') ? 'unavailable' : 'regression';
  const run = async (summary: { passed: number; total: number }) => {
    await writeFile(
      path.join(root, 'result.json'),
      JSON.stringify({ conclusion: { kind: conclusion }, summary }),
    );

    return (await checkRun(root, expected, pair.expectation.exitCode)).passed;
  };

  expect(await run({ passed, total })).toBe(true);
  expect(await run({ passed: total, total })).toBe(false);
  expect(await run({ passed, total: passed })).toBe(false);
});

test('corpus PNG decoder matches the comparator decoder on real screenshots', async () => {
  for (const name of ['base', 'heading-change', 'duplicate-request']) {
    const bytes = await readFile(
      path.join(import.meta.dirname, `fixtures/screenshots/${name}.png`),
    );
    const reference = decodeComparatorPng(bytes);
    if (reference.kind !== 'decoded') {
      throw new Error(`Comparator cannot decode ${name}`);
    }

    const decoded = decodePng(bytes);
    const rgb = reference.image.rgba.filter((_, index) => index % 4 !== 3);
    expect(decoded.channels).toBe(3);
    expect(decoded.width).toBe(reference.image.width);
    expect(Buffer.concat(decoded.rows).equals(Buffer.from(rgb))).toBe(true);
  }
});

test('corpus PNG decoder rejects inputs it cannot read exactly', async () => {
  const bytes = await readFile(path.join(import.meta.dirname, 'fixtures/screenshots/base.png'));
  const header = (offset: number, value: number) => {
    const changed = Buffer.from(bytes);
    changed[16 + offset] = value;

    return changed;
  };

  for (const invalid of [
    Buffer.from('not a png'),
    bytes.subarray(0, bytes.length - 20),
    header(8, 16),
    header(9, 3),
    header(9, 6),
    header(12, 1),
  ]) {
    expect(() => decodePng(invalid)).toThrow();
  }
});

test('intentional copy expectations inspect raw screenshots independently', async () => {
  const root = await fixture();
  const copy = pairs.find(({ expectation }) => expectation.gate === 6);
  const [first, ...rest] = (copy?.expectation.assertions ?? []).filter(
    ({ actual }) =>
      actual.kind === 'png-bands' ||
      actual.kind === 'visual-agrees' ||
      (actual.kind === 'text' && actual.file.endsWith('snapshot.yml')),
  );
  if (first === undefined || rest.length !== 4) {
    throw new Error('Missing screenshot inspection assertions');
  }

  const expectation: Expectation = {
    id: 'intentional-copy',
    gate: 6,
    reason: 'Raw screenshot inspection',
    exitCode: 0,
    assertions: [first, ...rest],
  };
  const width = 20;
  const lines = [2, 6, 10, 14];
  const image = (changed: number[], size = width) => {
    const rgb = new Uint8Array(size * 20 * 3).fill(255);
    for (const [index, y] of lines.entries()) {
      const x = changed.includes(index + 1) ? 6 : 3;
      rgb.fill(0, (y * size + x) * 3, (y * size + x + 4) * 3);
    }

    return encodeRgbPng(size, 20, rgb);
  };

  const visual = {
    kind: 'changed',
    width,
    height: 20,
    differingPixels: 6,
    regions: [{ x: 3, y: 6, width: 7, height: 1 }],
  };
  const write = async (
    candidate: Uint8Array = image([2]),
    reported: object = visual,
    copyText = 'Load your saved item list.',
  ) => {
    const files: [string, string | Uint8Array][] = [
      ['journey-1/base/screenshot.png', image([])],
      ['journey-1/candidate/screenshot.png', candidate],
      ['journey-1/base/snapshot.yml', '- paragraph: Load the saved items.'],
      ['journey-1/candidate/snapshot.yml', `- paragraph: ${copyText}`],
      ['result.json', JSON.stringify({ journeys: [{ comparison: { visual: reported } }] })],
    ];
    for (const [file, contents] of files) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), contents);
    }

    return (await checkRun(root, expectation, 0)).passed;
  };

  expect(await write()).toBe(true);
  for (const [label, candidate, reported, copyText] of [
    ['identical', image([])],
    ['second band', image([2, 3])],
    ['size', image([2], width + 1)],
    ['truncated', image([2]).subarray(0, 40)],
    ['count', undefined, { ...visual, differingPixels: 7 }],
    ['region', undefined, { ...visual, regions: [{ x: 3, y: 10, width: 7, height: 1 }] }],
    ['empty region', undefined, { ...visual, regions: [{ x: 5, y: 6, width: 0, height: 0 }] }],
    ['identical kind', undefined, { kind: 'identical', width, height: 20 }],
    ['unavailable', undefined, { kind: 'unavailable', reason: 'No image' }],
    ['size-differs', undefined, { kind: 'size-differs' }],
    ['below-threshold', undefined, { ...visual, kind: 'below-threshold' }],
    ['old copy', undefined, undefined, 'Load the saved items.'],
  ] as const) {
    expect.soft(await write(candidate, reported, copyText), label).toBe(false);
  }
});
