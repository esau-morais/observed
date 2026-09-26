import { Effect } from 'effect';
import path from 'node:path';
import { expect, test } from 'vitest';
import { summarize } from '../scripts/github-action';
import { compareCaptures, inspectSide } from '../src/comparison';
import { json } from '../src/encoding';

const evaluatedAt = '2026-09-23T12:00:00.000Z';
const root = path.resolve(import.meta.dirname, '..');

test('CI summaries never present unavailable or unreadable results as passing', async () => {
  const missing = await Effect.runPromise(
    inspectSide({ directory: null, prefix: 'candidate', evaluatedAt }),
  );
  const result = compareCaptures({
    base: missing,
    candidate: missing,
    evaluatedAt,
    visual: { kind: 'unavailable', reason: 'No captures' },
  });

  expect(result.conclusion.kind).toBe('unavailable');

  const unavailable = summarize({
    output: json({ directory: '/bundle', result }),
    exitCode: 1,
    artifact: 'observed-bundle',
  });
  const unreadable = summarize({
    output: '{"result":{"conclusion":{"kind":"no-regression"}}}',
    exitCode: 0,
    artifact: 'observed-bundle',
  });

  expect(unavailable.readable).toBe(true);
  expect(unavailable.markdown).toContain('## Observed: Unavailable');
  expect(unavailable.markdown).toContain('This is not a pass');
  expect(unreadable.readable).toBe(false);
  expect(unreadable.markdown).toContain('## Observed: no result');

  for (const { markdown } of [unavailable, unreadable]) {
    expect(markdown).not.toContain('job passes');
  }
});

test.each([
  { project: 'examples/shop', code: 1 },
  { project: 'examples/request-lab', code: 0 },
])(
  'CI preflight exits $code for $project because fill values would be exported',
  async ({ project, code }) => {
    const child = Bun.spawn(
      [process.execPath, 'scripts/github-action.ts', 'preflight', project],
      {
        cwd: root,
        env: { ...process.env, GITHUB_STEP_SUMMARY: '' },
        stdout: 'ignore',
        stderr: 'ignore',
      },
    );

    expect(await child.exited).toBe(code);
  },
);
