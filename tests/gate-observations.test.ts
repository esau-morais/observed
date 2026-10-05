import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { checkRun, type Expectation } from '../scripts/gate-corpus/check';

test('a timeline needs a recorded, matching raw tree, never unknown or not-run state', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'observed-timeline-gate-'));
  const expected = {
    id: 'timeline',
    gate: 2,
    reason: 'Raw state must corroborate the timeline.',
    exitCode: 0,
    assertions: [
      {
        label: 'state',
        actual: {
          kind: 'timeline-state',
          file: 'result.json',
          side: 'base',
          includes: 'Paint 1',
        },
        expected: true,
      },
    ],
  } satisfies Expectation;
  const tree = '- paragraph: Paint 1';
  const result = (state: unknown) =>
    JSON.stringify({
      journeys: [
        {
          base: {
            evidence: [{ kind: 'timeline', value: { finalState: state } }],
          },
        },
      ],
    });
  try {
    await mkdir(path.join(root, 'journey-1/base'), { recursive: true });
    await writeFile(
      path.join(root, 'journey-1/base/snapshot.json'),
      JSON.stringify({ success: true, data: { snapshot: tree } }),
    );
    await writeFile(
      path.join(root, 'result.json'),
      result({ kind: 'recorded', tree }),
    );
    expect((await checkRun(root, expected, 0)).passed).toBe(true);
    for (const state of [
      { kind: 'unknown' },
      { kind: 'unavailable', reason: 'incomplete' },
      { kind: 'not-run' },
      { kind: 'recorded', tree: 'Paint 1 forged tree' },
      { kind: 'recorded', tree: '' },
    ]) {
      await writeFile(path.join(root, 'result.json'), result(state));
      expect((await checkRun(root, expected, 0)).passed).toBe(false);
    }

    await writeFile(
      path.join(root, 'result.json'),
      result({ kind: 'recorded', tree }),
    );
    await rm(path.join(root, 'journey-1/base/snapshot.json'));
    expect((await checkRun(root, expected, 0)).passed).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('PNG byte difference requires both artifacts and does not count identical bytes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'observed-png-gate-'));
  const expected = {
    id: 'png',
    gate: 2,
    reason: 'Artifact difference is not a regression.',
    exitCode: 0,
    assertions: [
      {
        label: 'bytes differ',
        actual: {
          kind: 'png-different',
          file: 'base.png',
          other: 'candidate.png',
        },
        expected: true,
      },
    ],
  } satisfies Expectation;
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFz8AAAAASUVORK5CYII=',
    'base64',
  );
  try {
    await writeFile(path.join(root, 'base.png'), png);
    await writeFile(path.join(root, 'candidate.png'), png);
    expect((await checkRun(root, expected, 0)).passed).toBe(false);
    await rm(path.join(root, 'candidate.png'));
    expect((await checkRun(root, expected, 0)).passed).toBe(false);
    await writeFile(path.join(root, 'candidate.png'), 'unknown');
    expect((await checkRun(root, expected, 0)).passed).toBe(false);
    await writeFile(path.join(root, 'candidate.png'), png.subarray(0, 8));
    expect((await checkRun(root, expected, 0)).passed).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
