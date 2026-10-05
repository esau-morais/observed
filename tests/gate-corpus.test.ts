import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
  checkRun,
  select,
  type Expectation,
} from '../scripts/gate-corpus/check';
import { pairs } from '../scripts/gate-corpus/cases';
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
          base: { checks: [{ id: 'one-request', actual: 1 }] },
          candidate: { checks: [{ id: 'one-request', actual: 2 }] },
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
