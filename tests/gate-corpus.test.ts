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
  checkRun,
  select,
  type Expectation,
} from '../scripts/gate-corpus/check';
import { pairs } from '../scripts/gate-corpus/cases';
import { evidencePairs } from '../scripts/gate-corpus/evidence-cases';
import { browserPairs } from '../scripts/gate-corpus/browser-cases';
import { coveragePair } from '../scripts/gate-corpus/coverage-cases';
import { checkRequestFault } from '../scripts/gate-corpus/fault-check';
import {
  detectedFault,
  seededFaults,
} from '../scripts/gate-corpus/fault-cases';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
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
  expect(
    detectedFault((await checkRun(root, expected, 2)).failures, required),
  ).toBe(true);

  for (const raw of ['not JSON', '{}', '{"log":{"entries":[]}}']) {
    await writeFile(path.join(root, 'requests.har'), raw);
    expect(
      detectedFault((await checkRun(root, expected, 2)).failures, required),
    ).toBe(false);
  }

  await rm(path.join(root, 'requests.har'));
  expect(
    detectedFault((await checkRun(root, expected, 2)).failures, required),
  ).toBe(false);
});

test('request mutation classification retains pinned revision controls', async () => {
  const root = await fixture();
  const report = path.join(root, 'run/report');
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
  await writeFile(
    path.join(root, 'expected.json'),
    JSON.stringify(expectation),
  );
  const identity = path.join(report, 'identity.json');
  await writeFile(identity, JSON.stringify({ revision: 'pinned-base' }));
  const valid = await checkRequestFault(root, 0);
  expect(valid.raw.passed).toBe(true);
  expect(detectedFault(valid.result.failures, fault.requiredFailures)).toBe(
    true,
  );

  for (const broken of [
    JSON.stringify({ revision: 'wrong-base' }),
    '{}',
    'not JSON',
    null,
  ]) {
    if (broken === null) {
      await rm(identity);
    } else {
      await writeFile(identity, broken);
    }

    const checked = await checkRequestFault(root, 0);
    expect(checked.raw.passed).toBe(false);
    expect(detectedFault(checked.result.failures, fault.requiredFailures)).toBe(
      false,
    );
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
  await symlink(
    path.join(other, 'requests.har'),
    path.join(root, 'requests.har'),
  );

  expect((await checkRun(root, expected, 2)).failures.join(' ')).toContain(
    'outside the run',
  );
});

test('does not silently choose a duplicate check or treat a missing field as null', () => {
  expect(() =>
    select({ checks: [{ id: 'one' }, { id: 'one' }] }, [
      'checks',
      { key: 'id', equals: 'one' },
    ]),
  ).toThrow('found 2');
  expect(() => select({}, ['missing'])).toThrow('Missing field');
});

test('outside-source wording rejects missing scope, outside paths, and broader claims', async () => {
  const root = await fixture();
  const pair = pairs.find((item) => item.expectation.id === 'outside-source');
  if (pair === undefined) {
    throw new Error('Missing outside-source pair');
  }

  const assertions = pair.expectation.assertions.filter(
    (assertion) => assertion.actual.kind === 'text',
  );
  const [first, ...rest] = assertions;
  if (first === undefined) {
    throw new Error('Missing wording expectations');
  }

  const wording: Expectation = {
    ...pair.expectation,
    assertions: [first, ...rest],
  };
  const report = [
    'No captured file changed\\. 1 file changed outside the captured source\\.',
    '- README\\.md \\(modified\\)',
    'Checks cover only their stated expectations and scopes\\.',
  ].join('\n');
  await writeFile(path.join(root, 'report.md'), report);
  expect((await checkRun(root, wording, 0)).passed).toBe(true);

  for (const text of [
    '',
    'unknown',
    'incomplete',
    'not run',
    'none',
    ...assertions.flatMap((assertion) =>
      assertion.actual.kind !== 'text'
        ? []
        : [
            assertion.expected === true
              ? report.replace(assertion.actual.includes, '')
              : `${report}\n${assertion.actual.includes}`,
          ],
    ),
  ]) {
    await writeFile(path.join(root, 'report.md'), text);
    expect((await checkRun(root, wording, 0)).passed).toBe(false);
  }

  await rm(path.join(root, 'report.md'));
  expect((await checkRun(root, wording, 0)).passed).toBe(false);
  const other = await fixture();
  await writeFile(path.join(other, 'report.md'), report);
  await symlink(path.join(other, 'report.md'), path.join(root, 'report.md'));
  expect((await checkRun(root, wording, 0)).failures.join(' ')).toContain(
    'outside the run',
  );
});

test('requires innermost execution even when the result forges an exercised relation', async () => {
  const root = await fixture();
  const source =
    "document.querySelector('#error').addEventListener('click', () => {\n  throw new Error('Gate 3 invoice detail failed');\n});\n//# sourceMappingURL=gate-3-error.js.map\n";
  await writeFile(path.join(root, 'source.js'), source);
  // Range boundaries from trial #17, saved journey, agent-browser 0.38.1/CDP.
  const script = {
    url: 'http://localhost:1234/gate-3-error.js',
    functions: [
      { ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }] },
      { ranges: [{ startOffset: 59, endOffset: 119, count: 0 }] },
    ],
  };
  const raw = { result: [script] };
  await writeFile(path.join(root, 'coverage.json'), JSON.stringify(raw));
  await writeFile(
    path.join(root, 'result.json'),
    JSON.stringify({ relation: 'exercised' }),
  );
  const coverage: Extract<
    Expectation['assertions'][number]['actual'],
    { kind: 'coverage' }
  > = {
    kind: 'coverage',
    file: 'coverage.json',
    pathname: '/gate-3-error.js',
    source: 'source.js',
    line: 2,
    column: 2,
    functionRange: { startOffset: 59, endOffset: 119 },
  };
  const execution: Expectation = {
    id: 'raw-coverage',
    gate: 3,
    reason:
      'Outer script execution must not hide an unexecuted changed function.',
    exitCode: 0,
    assertions: [
      {
        label: 'relation',
        actual: { kind: 'json', file: 'result.json', path: ['relation'] },
        expected: 'exercised',
      },
      { label: 'changed line', actual: coverage, expected: true },
    ],
  };
  expect((await checkRun(root, execution, 0)).passed).toBe(false);
  await writeFile(
    path.join(root, 'coverage.json'),
    JSON.stringify({
      result: [{ ...script, functions: script.functions.slice(0, 1) }],
    }),
  );
  expect((await checkRun(root, execution, 0)).passed).toBe(false);
  await writeFile(path.join(root, 'coverage.json'), JSON.stringify(raw));
  const saved: Expectation = {
    ...execution,
    assertions: [{ label: 'saved line', actual: coverage, expected: false }],
  };
  expect((await checkRun(root, saved, 0)).passed).toBe(true);
  const counted: Expectation = {
    ...saved,
    assertions: [
      {
        label: 'exact executions',
        actual: { ...coverage, measure: 'count' },
        expected: 0,
      },
    ],
  };
  expect((await checkRun(root, counted, 0)).passed).toBe(true);
  expect(
    (
      await checkRun(
        root,
        {
          ...counted,
          assertions: [
            {
              label: 'wrong count',
              actual: { ...coverage, measure: 'count' },
              expected: 1,
            },
          ],
        },
        0,
      )
    ).passed,
  ).toBe(false);
  for (const invalid of [
    { kind: 'unknown' },
    { result: [] },
    { kind: 'not-run' },
    { result: [script, script] },
    { result: [{ ...script, functions: [] }] },
    {
      result: [
        {
          ...script,
          functions: [{ ranges: [{ startOffset: 0, endOffset: 0, count: 1 }] }],
        },
      ],
    },
    {
      result: [
        { ...script, functions: [...script.functions, script.functions[1]] },
      ],
    },
  ]) {
    await writeFile(path.join(root, 'coverage.json'), JSON.stringify(invalid));
    expect((await checkRun(root, saved, 0)).passed).toBe(false);
    expect((await checkRun(root, counted, 0)).passed).toBe(false);
  }

  await rm(path.join(root, 'coverage.json'));
  expect((await checkRun(root, saved, 0)).passed).toBe(false);
});

test('shifted mapping expectations reject forged lines and absent raw execution', async () => {
  const root = await fixture();
  const directory = path.join(root, 'journey-1/base');
  await mkdir(path.join(directory, 'source/public'), { recursive: true });
  const source = await readFile(
    path.join(
      import.meta.dirname,
      'fixtures/gate-coverage/public/counts.js.txt',
    ),
    'utf8',
  );
  await writeFile(path.join(directory, 'source/public/counts.js'), source);
  const [first, ...rest] = coveragePair.expectation.assertions.filter(
    ({ actual }) =>
      (actual.kind === 'coverage' && actual.file.includes('/base/')) ||
      (actual.kind === 'json' &&
        actual.path[0] === 'changeScope' &&
        actual.path.includes('lines')),
  );
  if (first === undefined) {
    throw new Error('Missing mapping assertions');
  }

  const expectation: Expectation = {
    ...coveragePair.expectation,
    assertions: [first, ...rest],
  };
  const script = {
    url: 'http://localhost:1234/counts.js',
    functions: [
      { ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }] },
      { ranges: [{ startOffset: 15, endOffset: 56, count: 1 }] },
      { ranges: [{ startOffset: 58, endOffset: 96, count: 0 }] },
    ],
  };
  const rawPath = path.join(directory, 'coverage-raw.json');
  await writeFile(rawPath, JSON.stringify({ result: [script] }));
  const result = async (ran: number[][], notRan: number[][]) => {
    await writeFile(
      path.join(root, 'result.json'),
      JSON.stringify({
        changeScope: { files: [{ path: 'counts.ts', lines: { ran, notRan } }] },
      }),
    );

    return (await checkRun(root, expectation, 0)).passed;
  };

  expect(await result([[2, 2]], [[6, 6]])).toBe(true);
  expect(await result([[4, 4]], [[8, 8]])).toBe(false);
  expect(
    await result(
      [
        [2, 2],
        [6, 6],
      ],
      [],
    ),
  ).toBe(false);
  expect(
    await result(
      [],
      [
        [2, 2],
        [6, 6],
      ],
    ),
  ).toBe(false);
  for (const invalid of [
    { kind: 'unknown' },
    { kind: 'incomplete', result: [] },
    { kind: 'not-run' },
    { result: [] },
    { result: [script, script] },
    { result: [{ ...script, functions: script.functions.slice(0, 1) }] },
    {
      result: [
        {
          ...script,
          functions: [
            script.functions[0],
            { ranges: [{ startOffset: 15, endOffset: 56, count: 0 }] },
            script.functions[2],
          ],
        },
      ],
    },
    {
      result: [
        {
          ...script,
          functions: [
            script.functions[0],
            script.functions[1],
            { ranges: [{ startOffset: 58, endOffset: 96, count: 1 }] },
          ],
        },
      ],
    },
  ]) {
    await writeFile(rawPath, JSON.stringify(invalid));
    expect(await result([[2, 2]], [[6, 6]])).toBe(false);
  }

  await rm(rawPath);
  expect(await result([[2, 2]], [[6, 6]])).toBe(false);
});

test('shifted mapping rejects unavailable mapped coverage despite retained scope claims', async () => {
  const root = await fixture();
  const labels = [
    'scope recorded',
    'saved journey coverage recorded',
    'base coverage recorded',
    'candidate coverage recorded',
  ];
  const [first, ...rest] = coveragePair.expectation.assertions.filter(
    ({ label }) => labels.includes(label),
  );
  if (first === undefined || rest.length !== labels.length - 1) {
    throw new Error('Missing scope availability assertions');
  }

  const expectation: Expectation = {
    ...coveragePair.expectation,
    assertions: [first, ...rest],
  };
  const coverage = { kind: 'coverage', status: 'recorded' };
  const journey = { journey: 'Load items', kind: 'recorded' };
  const result = (
    base: object[] = [coverage],
    candidate: object[] = [coverage],
    scope: object[] = [journey],
  ) => ({
    changeScope: { kind: 'recorded', coverage: scope },
    journeys: [{ base: { evidence: base }, candidate: { evidence: candidate } }],
  });
  const replacements = (recorded: object, field: string) => [
    [],
    [recorded, recorded],
    ...['unknown', 'incomplete', 'not-run', 'none'].map((state) => [
      { ...recorded, [field]: state },
    ]),
  ];
  const run = async (value: unknown) => {
    await writeFile(path.join(root, 'result.json'), JSON.stringify(value));

    return (await checkRun(root, expectation, 0)).passed;
  };

  expect(await run(result())).toBe(true);
  for (const evidence of replacements(coverage, 'status')) {
    expect.soft(await run(result(evidence)), JSON.stringify(evidence)).toBe(false);
    expect
      .soft(await run(result(undefined, evidence)), JSON.stringify(evidence))
      .toBe(false);
  }

  for (const scope of replacements(journey, 'kind')) {
    expect
      .soft(await run(result(undefined, undefined, scope)), JSON.stringify(scope))
      .toBe(false);
  }
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

      return (
        typeof field === 'string' &&
        ['execution', 'outcome', 'status'].includes(field)
      );
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
      checks: [...new Set(['one-request', 'loaded-text', fault.id])].map(
        (id) => ({
          id,
          outcome: candidate && id === fault.id ? 'failed' : 'passed',
          actual: 1,
        }),
      ),
      evidence: [
        ...new Set(['text', ...(fault.kind === null ? [] : [fault.kind])]),
      ].map((kind) => ({
        kind,
        status: 'recorded',
        value: { retained: true },
      })),
    });
    const base = side(false);
    const candidate = side(true);
    const check = async (sides: {
      base: typeof base;
      candidate: typeof candidate;
    }) => {
      await writeFile(
        path.join(root, 'result.json'),
        JSON.stringify({ journeys: [sides] }),
      );

      return (await checkRun(root, expected, 2)).passed;
    };

    expect(await check({ base, candidate })).toBe(true);
    for (const name of ['base', 'candidate'] as const) {
      for (const mutation of [
        'unknown',
        'not-run',
        'inverted',
        'execution',
        'evidence',
      ]) {
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
          const evidence = selected.evidence.find(
            (item) => item.kind === fault.kind,
          );
          if (evidence === undefined) {
            throw new Error('Missing evidence');
          }

          evidence.status = 'unavailable';
        } else {
          const inverted = name === 'base' ? 'failed' : 'passed';
          measured.outcome = mutation === 'inverted' ? inverted : mutation;
        }

        expect
          .soft(await check(changed), `${fault.pair} ${name} ${mutation}`)
          .toBe(false);
      }
    }
  }
});

test.each([
  ['relaxed-check', 1, 2],
  ['removed-check', 1, 2],
  ['rewritten-journey', 0, 2],
  ['removed-journey', 2, 4],
] as const)(
  '%s rejects inflated pass counts and missing checks',
  async (id, passed, total) => {
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
  },
);
