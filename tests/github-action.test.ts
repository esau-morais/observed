import { Effect } from 'effect';
import path from 'node:path';
import { expect, test } from 'vitest';
import {
  describeFailure,
  pageMatchesRun,
  summarize,
} from '../scripts/github-action';
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
    page: null,
  });
  const mismatched = summarize({
    output: json({ directory: '/bundle', result }),
    exitCode: 0,
    artifact: 'observed-bundle',
    page: null,
  });
  const unreadable = summarize({
    output: '{"result":{"conclusion":{"kind":"no-regression"}}}',
    exitCode: 0,
    artifact: 'observed-bundle',
    page: null,
  });

  expect(unavailable.trusted).toBe(true);
  expect(unavailable.markdown).toContain('## Observed: Unavailable');
  expect(unavailable.markdown).toContain('This is not a pass');

  for (const summary of [mismatched, unreadable]) {
    expect(summary.trusted).toBe(false);
    expect(summary.markdown).toContain('## Observed: no result');
  }

  for (const { markdown } of [unavailable, mismatched, unreadable]) {
    expect(markdown).not.toContain('job passes');
  }
});

test.each([
  { project: 'examples/shop', code: 0 },
  { project: 'tests', code: 1 },
])(
  'CI preflight exits $code for $project so only a loadable observed.json reaches capture',
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

test('a capture failure reason cannot break the job summary markup', () => {
  const [line = ''] = describeFailure('Candidate', {
    kind: 'failed',
    category: 'application',
    reason: 'exited | <img src=x> [link](http://x)',
  });

  expect(line).toContain('Candidate capture failed (application)');
  expect(line).not.toMatch(/<img|[^\\]\||[^\\]\[/);
  expect(describeFailure('Base', { kind: 'complete' })).toEqual([]);
});

test('the summary links only an https report page and cannot be steered by its URL', async () => {
  const missing = await Effect.runPromise(
    inspectSide({ directory: null, prefix: 'candidate', evaluatedAt }),
  );
  const result = compareCaptures({
    base: missing,
    candidate: missing,
    evaluatedAt,
    visual: { kind: 'unavailable', reason: 'No captures' },
  });
  const summary = (page: string | null) =>
    summarize({
      output: json({ directory: '/bundle', result }),
      exitCode: 1,
      artifact: 'observed-bundle',
      page,
    }).markdown;
  const page = 'https://github.com/o/r/actions/runs/1/artifacts/2';

  expect(summary(page)).toContain(`[Open the report](${page})`);
  expect(summary(page)).toContain('## Observed: Unavailable');

  expect(
    summarize({
      output: json({ directory: '/bundle', result }),
      exitCode: 0,
      artifact: 'observed-bundle',
      page,
    }).markdown,
  ).not.toContain('Open the report');

  for (const url of [
    null,
    'javascript:alert(1)',
    'https://x) ![img](https://y',
  ]) {
    expect(summary(url)).not.toContain('Open the report');
    expect(summary(url)).toContain('No report page was uploaded');
  }
});

test('a report page is written only when it shows the same result as the run', async () => {
  const missing = await Effect.runPromise(
    inspectSide({ directory: null, prefix: 'candidate', evaluatedAt }),
  );
  const result = compareCaptures({
    base: missing,
    candidate: missing,
    evaluatedAt,
    visual: { kind: 'unavailable', reason: 'No captures' },
  });
  const run = json({ directory: '/bundle', result });

  expect(pageMatchesRun(json(result), run)).toBe(true);
  expect(
    pageMatchesRun(
      json({
        ...result,
        conclusion: { kind: 'no-regression', text: 'No regression' },
      }),
      run,
    ),
  ).toBe(false);
  expect(pageMatchesRun(json(result), null)).toBe(false);
});
