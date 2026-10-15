import { Effect, Exit, Schema } from 'effect';
import { expect, test } from 'vitest';
import { playwright, type PlaywrightTest, type PlaywrightValue } from '../evidence/playwright';
import { checksForRun, testCheck } from './playwright';

const attempt = (
  status: PlaywrightTest['results'][number]['status'],
  error: string | null = null,
  retry = 0,
): PlaywrightTest['results'][number] => ({
  retry,
  status,
  duration: 10,
  startedAt: '2026-09-27T06:04:46.000Z',
  error,
  attachments: [],
});

const finishedError = [
  'Error: expect(locator).toHaveAttribute(expected) failed',
  '',
  "Locator:  getByRole('button', { name: 'Finished' })",
  'Expected: "true"',
  'Received: "false"',
  'Timeout:  5000ms',
  '',
  'Call log:',
  '  - Expect "toHaveAttribute" with timeout 5000ms',
  "  - waiting for getByRole('button', { name: 'Finished' })",
  '    9 × locator resolved to <button type="button" aria-pressed="false">Finished</button>',
  '      - unexpected value "false"',
  '',
].join('\n');

const countError = [
  'Error: expect(locator).toHaveText(expected) failed',
  '',
  "Locator:  getByRole('status')",
  'Expected: "3 books"',
  'Received: "2 books"',
  'Timeout:  2000ms',
  '',
].join('\n');

function shelfTest(
  title: string,
  line: number,
  outcome: PlaywrightTest['outcome'],
  results: PlaywrightTest['results'],
  overrides: Partial<PlaywrightTest> = {},
): PlaywrightTest {
  return {
    id: `chromium › shelves.spec.js › shelves › ${title}`,
    project: 'chromium',
    file: 'shelves.spec.js',
    source: null,
    line,
    titlePath: ['shelves', title],
    outcome,
    expectedStatus: 'passed',
    annotations: [],
    results,
    ...overrides,
  };
}

// The tests and outcomes Playwright 1.58.0 reported for a seeded run of
// observed-trial-vite-react: "1 failed, 1 flaky, 1 skipped, 2 passed".
const seededRun: PlaywrightValue = {
  report: 'json',
  version: '1.58.0',
  exitCode: 1,
  startedAt: '2026-09-27T06:04:45.570Z',
  duration: 17422.695,
  projects: ['chromium'],
  errors: [],
  stats: { expected: 2, unexpected: 1, flaky: 1, skipped: 1 },
  tests: [
    shelfTest('starts with no shelf selected', 4, 'expected', [attempt('passed')]),
    shelfTest('opens the Reading shelf', 10, 'expected', [attempt('passed')]),
    shelfTest('opens the Finished shelf', 17, 'unexpected', [
      attempt('failed', finishedError),
      attempt('failed', finishedError, 1),
    ]),
    shelfTest('exports the shelf as CSV', 24, 'skipped', [attempt('skipped')], {
      expectedStatus: 'skipped',
      annotations: [{ type: 'skip', description: null }],
    }),
    shelfTest('keeps the count after a second click', 28, 'flaky', [
      attempt('failed', countError),
      attempt('passed', null, 1),
    ]),
  ],
};

test('only a test that passed as expected passes; flaky and skipped tests stay unknown', () => {
  const checks = checksForRun(seededRun);

  expect(Object.fromEntries(checks.map((check) => [check.name, check.outcome]))).toEqual({
    'shelves › starts with no shelf selected': 'passed',
    'shelves › opens the Reading shelf': 'passed',
    'shelves › opens the Finished shelf': 'failed',
    'shelves › exports the shelf as CSV': 'unknown',
    'shelves › keeps the count after a second click': 'unknown',
  });
  expect(checks.every((check) => check.authority === 'Imported from Playwright')).toBe(true);
  expect(checks.find((check) => check.name === 'shelves › opens the Finished shelf')?.detail).toBe(
    'Failed on all 2 attempts. Error: expect(locator).toHaveAttribute(expected) failed (Expected: "true", Received: "false")',
  );
});

function syntheticTest(
  outcome: PlaywrightTest['outcome'],
  overrides: Partial<PlaywrightTest> = {},
): PlaywrightTest {
  return {
    id: 'chromium › cart.spec.ts › adds an item',
    project: 'chromium',
    file: 'cart.spec.ts',
    source: null,
    line: 3,
    titlePath: ['adds an item'],
    outcome,
    expectedStatus: 'passed',
    annotations: [],
    results: [
      {
        retry: 0,
        status: 'passed',
        duration: 10,
        startedAt: '2026-09-27T06:00:00.000Z',
        error: null,
        attachments: [],
      },
    ],
    ...overrides,
  };
}

test('an expected failure passes, and an interrupted test is unknown', () => {
  expect(
    testCheck(
      syntheticTest('expected', {
        expectedStatus: 'failed',
        results: [
          {
            retry: 0,
            status: 'failed',
            duration: 10,
            startedAt: '2026-09-27T06:00:00.000Z',
            error: 'Error: known bug',
            attachments: [],
          },
        ],
      }),
    ),
  ).toMatchObject({
    outcome: 'passed',
    detail: 'Marked with test.fail() and failed, as expected.',
  });
  expect(
    testCheck(
      syntheticTest('skipped', {
        results: [
          {
            retry: 0,
            status: 'interrupted',
            duration: 10,
            startedAt: '2026-09-27T06:00:00.000Z',
            error: null,
            attachments: [],
          },
        ],
      }),
    ),
  ).toMatchObject({
    outcome: 'unknown',
    detail: 'Interrupted before it finished. A skipped test is unknown, not passed.',
  });
});

test('a run with no tests, an error outside tests, or an unexplained exit code is unknown', () => {
  const empty: PlaywrightValue = {
    report: 'json',
    version: '1.58.0',
    exitCode: 1,
    startedAt: null,
    duration: 0,
    projects: ['chromium'],
    errors: ['Error: No tests found'],
    stats: { expected: 0, unexpected: 0, flaky: 0, skipped: 0 },
    tests: [],
  };

  expect(checksForRun(empty)).toEqual([
    expect.objectContaining({
      id: 'playwright-run',
      outcome: 'unknown',
      detail:
        'Playwright reported an error outside any test: Error: No tests found The report lists no tests.',
    }),
  ]);
  expect(
    checksForRun({
      ...empty,
      errors: [],
      stats: { ...empty.stats, expected: 1 },
      tests: [syntheticTest('expected')],
    }).map((check) => [check.id, check.outcome]),
  ).toEqual([
    ['playwright-run', 'unknown'],
    ['playwright: chromium › cart.spec.ts › adds an item', 'passed'],
  ]);
});

test('rejects a value whose tests disagree with the counts Playwright reported', () => {
  const value: PlaywrightValue = {
    report: 'json',
    version: '1.58.0',
    exitCode: 0,
    startedAt: null,
    duration: 0,
    projects: [],
    errors: [],
    stats: { expected: 2, unexpected: 0, flaky: 0, skipped: 0 },
    tests: [syntheticTest('expected')],
  };

  expect(
    Exit.isFailure(
      Effect.runSyncExit(
        Schema.encodeUnknownEffect(playwright.file)({
          kind: 'playwright',
          schemaVersion: 1,
          value,
        }),
      ),
    ),
  ).toBe(true);
});
