import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { checkRun, type Expectation } from '../scripts/gate-corpus/check';

const expectation = {
  id: 'load-budget-reader',
  gate: 2,
  reason:
    'A passing budget needs complete raw samples and the matching check measurement.',
  exitCode: 0,
  assertions: [
    {
      label: 'load within budget',
      actual: {
        kind: 'load-budget',
        file: 'result.json',
        side: 'base',
        check: 'load',
        max: 1000,
        samples: 3,
        warmup: 1,
      },
      expected: true,
    },
  ],
} satisfies Expectation;

test('timing reader rejects unknown, incomplete, not-run and forged measurements', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'observed-gate-timing-'));
  const directory = path.join(root, 'journey-1/base/performance');
  const samples = [50000, 20, 40, 60].map((load, index) => ({
    run: index + 1,
    warmup: index === 0,
    document: '/',
    metrics: { load },
  }));
  const result = {
    journeys: [
      {
        base: {
          execution: 'complete',
          checks: [
            {
              id: 'load',
              outcome: 'passed',
              actual: 'median 40 ms over 3 samples, range 20 ms to 60 ms',
            },
          ],
          evidence: [
            {
              kind: 'performance',
              status: 'recorded',
              value: { conditions: { samples: 3, warmup: 1 }, samples },
            },
          ],
        },
      },
    ],
  };
  const raw = (load: number | null, timeOrigin: number) => ({
    success: true,
    data: {
      result: JSON.stringify({
        observer: true,
        timeOrigin,
        document: '/',
        load,
      }),
    },
  });
  const filename = (run: number) =>
    path.join(directory, `run-${String(run).padStart(2, '0')}.json`);
  const write = (file: string, value: unknown) =>
    writeFile(file, JSON.stringify(value));
  const check = () => checkRun(root, expectation, 0);
  try {
    await mkdir(directory, { recursive: true });
    await write(path.join(root, 'result.json'), result);
    for (const sample of samples) {
      await write(filename(sample.run), raw(sample.metrics.load, sample.run));
    }

    expect((await check()).passed).toBe(true);

    const base = result.journeys[0]?.base;
    for (const overrides of [
      ...['unknown', 'not-run', 'failed'].map((outcome) => ({
        checks: [
          {
            id: 'load',
            outcome,
            actual: 'median 40 ms over 3 samples, range 20 ms to 60 ms',
          },
        ],
      })),
      ...['unknown', 'failed', 'blocked'].map((execution) => ({ execution })),
      ...['unavailable', 'unknown', 'not-run'].map((status) => ({
        evidence: [
          {
            kind: 'performance',
            status,
            value: { conditions: { samples: 3, warmup: 1 }, samples },
          },
        ],
      })),
    ]) {
      await write(path.join(root, 'result.json'), {
        journeys: [{ base: { ...base, ...overrides } }],
      });
      expect
        .soft((await check()).passed, JSON.stringify(overrides))
        .toBe(false);
    }

    await write(path.join(root, 'result.json'), result);

    await write(filename(3), raw(null, 3));
    expect((await check()).passed).toBe(false);
    await rm(filename(3));
    expect((await check()).passed).toBe(false);
    await write(filename(3), raw(40, 3));

    await write(path.join(root, 'result.json'), {
      journeys: [
        {
          base: {
            ...result.journeys[0]?.base,
            checks: [{ id: 'load', outcome: 'not-run', actual: null }],
          },
        },
      ],
    });
    expect((await check()).passed).toBe(false);
    await write(path.join(root, 'result.json'), result);

    await write(filename(3), raw(41, 3));
    expect((await check()).passed).toBe(false);
    await write(filename(3), raw(40, 2));
    expect((await check()).passed).toBe(false);
    await write(filename(3), raw(40, 3));
    expect(
      (
        await checkRun(
          root,
          {
            ...expectation,
            assertions: [{ ...expectation.assertions[0], expected: false }],
          },
          0,
        )
      ).passed,
    ).toBe(false);
    expect((await check()).passed).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
