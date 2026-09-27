import { Effect } from 'effect';
import path from 'node:path';
import { expect, test } from 'vitest';
import {
  capturedRevision,
  describeFailure,
  inlineText,
  jobOutcome,
  pageMatchesRun,
  summarize,
  type Surface,
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
    surface: { kind: 'comment' },
  });
  const mismatched = summarize({
    output: json({ directory: '/bundle', result }),
    exitCode: 0,
    artifact: 'observed-bundle',
    page: null,
    surface: { kind: 'comment' },
  });
  const unreadable = summarize({
    output: '{"result":{"conclusion":{"kind":"no-regression"}}}',
    exitCode: 0,
    artifact: 'observed-bundle',
    page: null,
    surface: { kind: 'comment' },
  });

  expect(unavailable.trusted).toBe(true);
  expect(unavailable.markdown).toContain('> [!WARNING]\n> **Unavailable** · ');
  expect(unavailable.markdown).toContain('Missing evidence is not a pass');

  for (const summary of [mismatched, unreadable]) {
    expect(summary.trusted).toBe(false);
    expect(summary.markdown).toContain(
      'No result. Treat this run as unavailable, not passed.',
    );
  }

  for (const { markdown } of [unavailable, mismatched, unreadable]) {
    expect(markdown).not.toContain('job passes');
    expect(markdown).not.toContain('[!NOTE]');
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

  expect(line).toBe(
    '- Candidate capture failed (application): exited \\| \\<img src=x> \\[link](`http://x)`',
  );
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
      surface: { kind: 'comment' },
    }).markdown;
  const page = 'https://github.com/o/r/actions/runs/1/artifacts/2';

  expect(summary(page)).toContain(`[Open the report](${page})`);
  expect(summary(page)).toContain('> [!WARNING]');

  expect(
    summarize({
      output: json({ directory: '/bundle', result }),
      exitCode: 0,
      artifact: 'observed-bundle',
      page,
      surface: { kind: 'comment' },
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

test('a URL in check text renders as code so GitHub cannot autolink the captured origin', () => {
  expect(
    inlineText(
      'Exactly 1 GET http://127.0.0.1:4010/api/books request(s) with status 200.',
    ),
  ).toBe(
    'Exactly 1 GET `http://127.0.0.1:4010/api/books` request(s) with status 200.',
  );
  expect(inlineText('See https://x.test/a.')).toBe('See `https://x.test/a`.');
});

test('captured text stays plain for agents yet cannot add markup, mentions or references', () => {
  expect(
    inlineText(
      'median 1.5 ms (+20%) in my_file.ts: *bold* _em_ [x](y) <b> ~s~ `c` \\* &amp; @octocat #12 #book-filter',
    ),
  ).toBe(
    'median 1.5 ms (+20%) in my_file.ts: \\*bold\\* \\_em\\_ \\[x](y) \\<b> \\~s\\~ \\`c\\` \\\\\\* &amp;amp; @\u200boctocat #\u200b12 #book-filter',
  );
  expect(inlineText('> quoted')).toBe('\\> quoted');
  expect(inlineText('- item')).toBe('\\- item');
  expect(inlineText('1. first')).toBe('1\\. first');
  expect(inlineText('$10-$20 for me@example.com')).toBe(
    '\\$10-\\$20 for me@example.com',
  );
  expect(inlineText('see \\https://x.test/a')).toBe(
    'see \\\\`https://x.test/a`',
  );
});

async function regressionRun(detail: string) {
  const missing = await Effect.runPromise(
    inspectSide({ directory: null, prefix: 'candidate', evaluatedAt }),
  );
  const result = compareCaptures({
    base: missing,
    candidate: missing,
    evaluatedAt,
    visual: { kind: 'unavailable', reason: 'No captures' },
  });
  const [journey] = result.journeys;
  const identity = {
    scope: 'Open the page',
    expectation: 'Median LCP at most 250 ms.',
  };

  return json({
    directory: '/bundle',
    result: {
      ...result,
      journeys: [
        {
          ...journey,
          checks: [
            {
              ...identity,
              id: 'lcp',
              name: 'Largest contentful paint stays fast',
              verdict: 'regression',
              detail,
              measure: {
                label: 'Median LCP',
                base: '52 ms',
                candidate: '452 ms',
                limit: 'at most 250 ms',
              },
            },
            {
              ...identity,
              id: 'books',
              name: 'One books request',
              verdict: 'passed',
              detail: 'Observed 1 matching request.',
            },
          ],
        },
      ],
      summary: { passed: 1, total: 2 },
      conclusion: { kind: 'regression', text: detail },
    },
  });
}

test('the verdict line carries the values once and passing checks become a count', async () => {
  const detail = 'Largest contentful paint stays fast regressed.';
  const summary = summarize({
    output: await regressionRun(detail),
    exitCode: 2,
    artifact: 'observed-bundle',
    page: null,
    surface: { kind: 'comment' },
  });
  const visible = summary.markdown
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<details>[\s\S]*?<\/details>/g, '');

  expect(summary.title).toBe(
    'Regression: Median LCP 52 ms → 452 ms, at most 250 ms',
  );
  expect(visible).toContain(
    '> **Regression** · Largest contentful paint stays fast · Median LCP 52 ms → 452 ms, at most 250 ms\n>\n> 1 issue found · 1 behavior verified · 0 unresolved',
  );
  expect(visible.split('52 ms → 452 ms')).toHaveLength(2);
  expect(visible).not.toContain(detail);
  expect(visible).not.toContain('One books request');

  const check = summarize({
    output: await regressionRun(detail),
    exitCode: 2,
    artifact: 'observed-bundle',
    page: null,
    surface: { kind: 'check' },
  }).markdown;

  expect(check).toContain(
    '- ! **Regression** · Largest contentful paint stays fast · Median LCP 52 ms → 452 ms, at most 250 ms',
  );
});

test('captured text cannot close the agent prompt fence, and the artifact name cannot close the hidden agent block', async () => {
  const detail = 'Error: ```\n</details>\n--> @octocat';
  const { markdown } = summarize({
    output: await regressionRun(detail),
    exitCode: 2,
    artifact: 'bundle-->x',
    page: null,
    surface: { kind: 'comment' },
  });
  const prompt =
    /<summary>Prompt for your agent<\/summary>\n\n(`{4,})text\n([\s\S]*?)\n\1\n\n<\/details>/.exec(
      markdown,
    );
  const block = /<!-- observed:agent\n([\s\S]*?)\n-->/.exec(markdown);

  expect(prompt?.[2]).toContain(`- Evidence: ${detail}`);
  expect(prompt?.[2]).toContain(
    'A changed value is not a regression by itself; verify against the artifacts',
  );
  expect(block?.[1]).toContain('artifact: bundle--x');
  expect(block?.[1]).toContain('conclusion: regression');
});

test('the job summary says the job passes only when the Observed check carries a failing result', async () => {
  const output = await regressionRun('Regressed.');
  const render = (surface: Surface, exitCode = 2) =>
    summarize({
      output,
      exitCode,
      artifact: 'observed-bundle',
      page: null,
      surface,
    }).markdown;

  expect(render({ kind: 'job', checkPosted: true })).toContain(
    jobOutcome(true),
  );
  expect(render({ kind: 'job', checkPosted: false })).toContain(
    'The job fails',
  );
  expect(render({ kind: 'comment' })).not.toMatch(/The job|this job/);
  expect(render({ kind: 'job', checkPosted: false }, 0)).toContain(
    'The job fails',
  );
});

test('a result is posted to a pull request only when its candidate is that head or its merge commit', () => {
  const head = 'a'.repeat(40);

  expect(capturedRevision(null, [head])).toBe('unavailable');
  expect(capturedRevision({ kind: 'commit', commit: head }, [head])).toBe(
    'match',
  );
  expect(
    capturedRevision({ kind: 'commit', commit: 'c'.repeat(40) }, [head]),
  ).toBe('other');
  expect(
    capturedRevision(
      { kind: 'worktree', head: { kind: 'commit', commit: head } },
      [head],
    ),
  ).toBe('other');
});
