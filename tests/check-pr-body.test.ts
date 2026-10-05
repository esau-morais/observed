import { expect, test } from 'vitest';
import { checkPrBody } from '../scripts/check-pr-body';

const visual = { visual: true };
const screenshot = '![the viewer after](https://example.test/after.png)';
const flow = '```mermaid\nflowchart LR\n  a --> b\n```';
const prose = (words: number) =>
  Array.from({ length: words }, () => 'word').join(' ');

test('a short body that opens with a screenshot, a mermaid flow or a before | after table passes', () => {
  for (const opening of [
    screenshot,
    flow,
    '| before | after |\n| --- | --- |\n| ![before](b.png) | ![after](a.png) |',
  ]) {
    expect(
      checkPrBody(
        `${opening}\n\nthe comment shows the scene.\n\n## checks\n\n- ok\n\n## not verified\n\n- windows`,
        visual,
      ).problems,
    ).toEqual([]);
  }
});

test('a body that opens with prose, or a table of text, has no opening visual', () => {
  for (const body of [
    `this adds a scene.\n\n${screenshot}`,
    '| run | result |\n| --- | --- |\n| 1 | ok |',
    '',
  ]) {
    expect(checkPrBody(body, visual).problems).toEqual([
      expect.stringMatching(/^open with a visual/),
    ]);
  }
});

test('release and pin PRs may skip the visual with --no-visual, and keep the other limits', () => {
  expect(
    checkPrBody('bumps the version to 0.2.0-alpha.6.', { visual: false })
      .problems,
  ).toEqual([]);
  expect(checkPrBody(prose(151), { visual: false }).problems).toEqual([
    expect.stringMatching(/^prose is 151 words/),
  ]);
});

test('prose over 150 words fails; code, images, links and table rows do not count', () => {
  const uncounted = [
    '```ts\nconst lots = "of words that are code";\n```',
    '| a lot | of table words |',
    '[link text](https://example.test/long/path)',
  ].join('\n\n');

  expect(
    checkPrBody(`${screenshot}\n\n${prose(148)}\n\n${uncounted}`, visual),
  ).toEqual({
    words: 150,
    problems: [],
  });
  expect(
    checkPrBody(`${screenshot}\n\n${prose(151)}`, visual).problems,
  ).toEqual([expect.stringMatching(/^prose is 151 words/)]);
});

test('more than two headings fails', () => {
  expect(
    checkPrBody(
      `${screenshot}\n\n## what\n\n## checks\n\n## not verified`,
      visual,
    ).problems,
  ).toEqual(['3 headings; use at most 2 (checks, not verified)']);
});

test('lines that narrate files fail', () => {
  expect(
    checkPrBody(
      `${screenshot}\n\n- \`scripts/check-pr-body.ts\`: the check\n- src/report.ts — renders it\n- the viewer shows the gate`,
      visual,
    ).problems,
  ).toEqual(['2 lines narrate files; the diff shows those']);
});

test('review and process sections fail', () => {
  expect(
    checkPrBody(
      `${screenshot}\n\n## review\n\nfixed two findings\n\n## process`,
      visual,
    ).problems,
  ).toEqual([
    'drop the "review" section; keep only declined findings, in one line',
    'drop the "process" section; keep only declined findings, in one line',
  ]);
});
