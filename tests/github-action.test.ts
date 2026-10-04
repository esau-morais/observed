import { Effect } from 'effect';
import path from 'node:path';
import { expect, test } from 'vitest';
import {
  capturedRevision,
  describeFailure,
  inlineText,
  pageMatchesRun,
  summarize,
  type Screenshots,
} from '../scripts/github-action';
import { Schema } from 'effect';
import { readFile } from 'node:fs/promises';
import {
  compareCaptures,
  inspectSide,
  summarizeJourneys,
} from '../src/comparison';
import { comparisonSchema } from '../src/comparison-model';
import { json, sha256 } from '../src/encoding';
import { failedJourney } from './support/failed-journey';

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
    '> **Regression** · Largest contentful paint stays fast · Median LCP 52 ms → 452 ms, at most 250 ms\n>\n> 1 check passed · 1 regression',
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
    /\*\*Prompt for your agent\*\*\n\n(`{4,})text\n([\s\S]*?)\n\1\n/.exec(
      markdown,
    );
  const block = /<!-- observed:agent\n([\s\S]*?)\n-->/.exec(markdown);

  expect(prompt?.[2]).toContain(`- Evidence: ${detail}`);
  expect(prompt?.[2]).toContain(
    '- Compare each value with its artifact before you change code.',
  );
  expect(block?.[1]).toContain('artifact: bundle--x');
  expect(block?.[1]).toContain('conclusion: regression');
});

test('a failed delivery or image upload leaves the verdict and its trust unchanged and ends the job summary', async () => {
  const output = await regressionRun('Regressed.');
  const render = (
    delivery: string | null,
    screenshots: Screenshots | null = null,
  ) =>
    summarize({
      output,
      exitCode: 2,
      artifact: 'observed-bundle',
      page: null,
      surface: { kind: 'job' },
      delivery,
      screenshots,
    });
  const line =
    "Not posted: check title and comment. Add checks: write to the workflow's permissions.";
  const failed = render(line);
  const linked = render(null, {
    image: null,
    link: null,
    note: 'The comment does not show the screenshot crops. GitHub refused the image upload with HTTP 404.',
  });
  const verdict = ({ trusted, title, kind }: ReturnType<typeof render>) => ({
    trusted,
    title,
    kind,
  });

  expect(verdict(failed)).toEqual(verdict(render(null)));
  expect(verdict(linked)).toEqual(verdict(render(null)));
  expect(failed.markdown.trimEnd().endsWith(line)).toBe(true);
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

test("a check row shows its own finding's anchor and no other check's", async () => {
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
  const identity = { scope: 'Open the shelf', expectation: 'No errors.' };
  const output = json({
    directory: '/bundle',
    result: {
      ...result,
      journeys: [
        {
          ...journey,
          checks: [
            {
              ...identity,
              id: 'no-browser-errors',
              name: 'No browser errors',
              verdict: 'regression',
              detail: '1 error.',
            },
            {
              ...identity,
              id: 'books',
              name: 'One books request',
              verdict: 'failed',
              detail: 'Observed 2 matching requests.',
            },
          ],
          findings: [
            {
              id: 'browser-errors:0123456789abcdef',
              evidence: 'browser-errors',
              checks: ['no-browser-errors'],
              subject: 'TypeError thrown',
              comparison: 'new',
              location: {
                kind: 'anchored',
                anchors: [
                  {
                    path: 'src/App.jsx',
                    line: 10,
                    side: 'candidate',
                    basis: 'stack-frame',
                    evidence: 'Stack frame 1, resolved by its source map.',
                    artifacts: [],
                    diff: 'added',
                  },
                ],
              },
            },
          ],
        },
      ],
      summary: { passed: 0, total: 2 },
      conclusion: { kind: 'regression', text: 'No browser errors regressed.' },
    },
  });
  const markdown = summarize({
    output,
    exitCode: 2,
    artifact: 'observed-bundle',
    page: null,
    surface: { kind: 'check' },
  }).markdown;
  const rows = markdown.split('\n');

  expect(
    rows.filter((row) => row.includes('thrown at `src/App.jsx:10`')),
  ).toHaveLength(1);
  expect(rows.find((row) => row.includes('One books request'))).not.toContain(
    'App.jsx',
  );
});

test('a failure shared by every capture is one comment line that names the base', async () => {
  const fixture = Schema.decodeUnknownSync(
    Schema.fromJsonString(comparisonSchema),
  )(
    await readFile(
      path.join(root, 'tests/fixtures/report/errors-result.json'),
      'utf8',
    ),
  );
  const [journey] = fixture.journeys;

  if (journey === undefined) {
    throw new Error('The fixture has one journey');
  }

  const stale = 'Setup step 4 of 4 (sh) exited with code 1: fixture is stale';
  const failed = failedJourney(journey, stale, evaluatedAt);
  const result = summarizeJourneys({
    journeys: [
      { ...failed, title: 'Open the report' },
      { ...failed, title: 'Find the request' },
    ],
    evaluatedAt,
    mode: 'comparison',
  });
  const summary = summarize({
    output: json({ directory: '/bundle', result }),
    exitCode: 1,
    artifact: 'observed-bundle',
    page: null,
    surface: { kind: 'comment' },
  });
  const [visible = ''] = summary.markdown.split('<details>');

  expect(summary.title).toBe('Unavailable: Every capture failed');
  expect(visible).toContain('> **Unavailable** · Every capture failed\n');
  expect(visible.split(stale)).toHaveLength(2);
  expect(visible).toContain(
    `- ? **Unknown** · Open the report: No browser errors, Find the request: No browser errors\n\n- Every capture failed (application): ${stale}\n`,
  );
});

// The comment is the glance: verdict, screenshots, the files that matter and
// the report link. Features once added lines until the comment read like an
// audit log and listed 26 files no evidence touched.
const visibleCommentLimit = 900;

type Unobserved = { path: string; change: 'added' | 'modified' };

async function typicalFailingRun(
  options: { unobserved?: readonly Unobserved[]; gitListed?: boolean } = {},
): Promise<string> {
  const fixture = Schema.decodeUnknownSync(
    Schema.fromJsonString(comparisonSchema),
  )(
    await readFile(
      path.join(root, 'tests/fixtures/report/errors-result.json'),
      'utf8',
    ),
  );
  const [journey] = fixture.journeys;
  const scope = fixture.changeScope;

  if (journey === undefined || scope.kind !== 'recorded') {
    throw new Error('The fixture has a journey and a recorded change scope');
  }

  const [regressed] = journey.checks;
  const passing = ['Shelf opens', 'One books request', 'No layout shift'].map(
    (name, index) => ({
      ...regressed,
      id: `passing-${String(index)}`,
      name,
      verdict: 'passed' as const,
    }),
  );
  const outside = Array.from({ length: 30 }, (_, index) => ({
    path: `../docs/page-${String(index).padStart(2, '0')}.md`,
    change: 'modified' as const,
    captured: false as const,
    relation: 'outside-captured-source' as const,
    basis: 'none' as const,
    reason: 'Neither source snapshot contains this file.',
    journeys: [],
    checks: [],
  }));

  return json({
    directory: '/bundle',
    result: {
      ...fixture,
      journeys: [
        {
          ...journey,
          checks: [...journey.checks, ...passing],
          comparison: {
            ...journey.comparison,
            visual: {
              kind: 'changed',
              width: 1280,
              height: 800,
              threshold: 0.1,
              differingPixels: 40_000,
              changedPixels: 32_292,
              regionCount: 3,
              regions: [
                {
                  x: 40,
                  y: 120,
                  width: 600,
                  height: 48,
                  changedPixels: 20_000,
                },
                { x: 40, y: 400, width: 300, height: 30, changedPixels: 8_000 },
                { x: 900, y: 40, width: 200, height: 30, changedPixels: 4_292 },
              ],
              diff: {
                path: 'journey-1/visual-diff.png',
                sha256: 'a'.repeat(64),
              },
            },
          },
        },
      ],
      summary: { passed: 3, total: 4 },
      changeScope: {
        ...scope,
        outside:
          options.gitListed === false
            ? {
                kind: 'unavailable',
                reason: 'Git could not list the changed files.',
              }
            : { kind: 'listed', projectDirectory: 'web' },
        files: [
          ...(options.gitListed === false ? [] : outside),
          ...scope.files,
          ...(options.unobserved ?? []).map((file) => ({
            ...file,
            captured: true,
            relation: 'not-observed',
            basis: 'none',
            reason: 'No recorded evidence touched this file.',
            journeys: [],
            checks: [],
          })),
          {
            path: 'src/Shelf.jsx',
            change: 'modified',
            captured: true,
            relation: 'not-observed',
            basis: 'none',
            reason: 'No recorded evidence touched this file.',
            journeys: [],
            checks: [],
          },
          {
            path: 'src/books.js',
            change: 'added',
            captured: true,
            relation: 'exercised',
            basis: 'stack-frame',
            journeys: [journey.title],
            checks: [],
          },
        ],
      },
    },
  });
}

const head = 'b'.repeat(40);

function comment(output: string, pullRequest: number | null) {
  return summarize({
    output,
    exitCode: 2,
    artifact: 'observed-bundle',
    page: 'https://github.com/o/r/actions/runs/1/artifacts/2',
    repository: 'https://github.com/o/r',
    pullRequest,
    headSha: head,
    screenshots: {
      image: null,
      link: 'https://github.com/o/r/actions/runs/1/artifacts/3',
      note: null,
    },
    surface: { kind: 'comment' },
  }).markdown.replace(/<!--[\s\S]*?-->|<details>[\s\S]*?<\/details>/g, '');
}

// What a reader sees: link targets are not shown.
function readable(markdown: string): string {
  return markdown.replace(/\]\(https:[^)]*\)/g, ']');
}

test(`a typical failing run's comment stays within ${String(visibleCommentLimit)} visible characters and shows paths from the repository root`, async () => {
  const visible = comment(await typicalFailingRun(), 7);

  expect(readable(visible).length).toBeLessThanOrEqual(visibleCommentLimit);
  expect(visible.length).toBeLessThanOrEqual(2 * visibleCommentLimit);
  expect(visible).toContain(
    '| Outside the captured source | 30, counted only |',
  );
  const rows = ['| Not observed |', '| Exercised |', '| Checked |'].map((row) =>
    visible.indexOf(row),
  );

  expect(rows.every((at, index) => at > (rows[index - 1] ?? -1))).toBe(true);
  expect(visible).not.toContain('docs/page-');
  expect(visible).not.toContain('../');
  expect(visible).toContain(
    '[Before, after and changed pixels, left to right](https://github.com/o/r/actions/runs/1/artifacts/3)',
  );
});

// A link to the wrong anchor lands on the top of the diff, or on nothing.
test('changed files and the verdict line link to their diff in the pull request, and otherwise to the head commit', async () => {
  const output = await typicalFailingRun();
  const diff = (file: string) =>
    `https://github.com/o/r/pull/7/changes#diff-${sha256(file)}`;

  const onPullRequest = comment(output, 7);

  expect(onPullRequest).toContain(
    `thrown at [\`web/src/App.jsx:10\`](${diff('web/src/App.jsx')}R10)`,
  );
  expect(onPullRequest).toContain(
    `| Exercised | [\`web/src/books.js\`](${diff('web/src/books.js')}) (added) |`,
  );

  const blob = `thrown at [\`web/src/App.jsx:10\`](https://github.com/o/r/blob/${head}/web/src/App.jsx#L10)`;
  const run = Schema.decodeUnknownSync(
    Schema.fromJsonString(
      Schema.Struct({ directory: Schema.String, result: comparisonSchema }),
    ),
  )(output);
  const scope = run.result.changeScope;
  const unchangedAnchor = json({
    ...run,
    result: {
      ...run.result,
      changeScope:
        scope.kind === 'recorded'
          ? {
              ...scope,
              files: scope.files.filter((file) => file.path !== 'src/App.jsx'),
            }
          : scope,
    },
  });

  expect(comment(output, null)).toContain(blob);
  expect(comment(unchangedAnchor, 7)).toContain(blob);
});

// A long list of unobserved files once used up the listed-file limit and
// pushed the file the regression points into out of the comment.
test('with many changed files every row still names a file, the regression file stays listed, and the comment stays within its limit', async () => {
  const unobserved = Array.from({ length: 14 }, (_, index) => ({
    path: `src/features/checkout/payment-methods/stored-card-${String(index).padStart(2, '0')}.jsx`,
    change: 'modified' as const,
  }));
  const visible = comment(await typicalFailingRun({ unobserved }), 7);
  const row = (name: string) =>
    visible.split('\n').find((line) => line.startsWith(`| ${name} |`)) ?? '';

  expect(row('Checked')).toContain('`web/src/App.jsx`');
  expect(row('Exercised')).toContain('`web/src/books.js`');
  expect(row('Not observed')).toContain('more in the report');
  expect(readable(visible).length).toBeLessThanOrEqual(visibleCommentLimit);
});

// Self-observe once repeated one missing source map under every file it
// listed, and spread the rest over three collapsed blocks.
test('files that share a reason name it once, inside the one collapsed block after the report link', async () => {
  const reason = 'No recorded evidence touched this file.';
  const unobserved = ['src/a.jsx', 'src/b.jsx'].map((file) => ({
    path: file,
    change: 'modified' as const,
  }));
  const { markdown } = summarize({
    output: await typicalFailingRun({ unobserved }),
    exitCode: 2,
    artifact: 'observed-bundle',
    page: 'https://github.com/o/r/actions/runs/1/artifacts/2',
    surface: { kind: 'comment' },
  });
  const [visible = '', collapsedPart = ''] = markdown.split('<details>');

  expect(markdown.split(reason)).toHaveLength(2);
  expect(collapsedPart).toContain(
    `- \`web/src/a.jsx\`, \`web/src/b.jsx\`, \`web/src/Shelf.jsx\` · ${reason}`,
  );
  expect(markdown.split('<details>')).toHaveLength(2);
  expect(visible.trimEnd()).toMatch(/\*\*\[Open the report\]\([^)]+\)\*\*$/);
});

// A pipe in a captured path would split the table row into extra cells.
test('a pipe in a changed path stays inside its table cell', async () => {
  const visible = comment(
    await typicalFailingRun({
      unobserved: [{ path: 'src/a|b`c.js', change: 'modified' }],
    }),
    null,
  );
  const row =
    visible.split('\n').find((line) => line.startsWith('| Not observed |')) ??
    '';

  expect(row).toContain('web/src/a\\|b');
  expect(row.replaceAll('\\|', '').split('|')).toHaveLength(4);
});

// Missing evidence must stay in view: unknown outside files and unavailable
// coverage weaken what "not observed" means.
test('when Git listed no changes, the comment says files outside the captured source are unknown, outside any collapsed block', async () => {
  const visible = comment(await typicalFailingRun({ gitListed: false }), 7);

  expect(visible).toContain(
    '| Outside the captured source | Unknown: Git could not list the changed files. |',
  );
  expect(visible).toContain('- Coverage unavailable');
});
