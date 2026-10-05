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
    'before | after\n--- | ---\n<img src="b.png"> | <img src="a.png">',
    '[![the comment](https://example.test/c.png)](https://example.test/pr/1)',
    '<p align="center"><img width="600" src="https://github.com/user-attachments/assets/x"></p>',
    '![the change][shot]\n\n[shot]: https://example.test/after.png',
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
    '![an image reference that renders nothing]',
    '<img src="" alt="nothing">',
    '<img data-src="lazy.png">',
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

test('prose over 150 words fails, counting table cells but not code, images or link destinations', () => {
  const mixedMarkdown = [
    '```ts\nconst lots = "of words that are code";\n```',
    '![a long alt text](https://example.test/a.png)',
    '[link](https://example.test/long/path)',
    '| run | result |\n| --- | --- |',
  ].join('\n\n');

  expect(
    checkPrBody(`${screenshot}\n\n${prose(147)}\n\n${mixedMarkdown}`, visual),
  ).toEqual({ words: 150, problems: [] });
  expect(
    checkPrBody(`${screenshot}\n\n${prose(151)}`, visual).problems,
  ).toEqual([expect.stringMatching(/^prose is 151 words/)]);
  expect(
    checkPrBody(
      `${screenshot}\n\n| a | b |\n| --- | --- |\n| ${prose(150)} | x |`,
      visual,
    ).problems,
  ).toEqual([expect.stringMatching(/^prose is 153 words/)]);
});

test('more than two headings fails, indented or underlined ones included, but not lines in code', () => {
  expect(
    checkPrBody(
      `${screenshot}\n\n  ## what\n\nchecks\n------\n\nnot verified\n===\n\n\`\`\`sh\n# a shell comment\n\`\`\``,
      visual,
    ).problems,
  ).toEqual(['3 headings; use at most 2 (checks, not verified)']);
});

test('lines that narrate files fail', () => {
  expect(
    checkPrBody(
      `${screenshot}\n\n- \`scripts/check-pr-body.ts\`: the check\n- src/report.ts — renders it\n1. viewer/app.css adds a color\n- the viewer shows the gate\n- 0.2.0-alpha.6 is on npm\n- example.com answers\n- **Dockerfile** pins bun\n\nthe rest is code.\n\n    - src/in-code.ts`,
      visual,
    ).problems,
  ).toEqual(['4 lines narrate files; the diff shows those']);
});

test('review and process sections fail', () => {
  expect(
    checkPrBody(
      `${screenshot}\n\nreview\n---\n\nfixed two findings\n\n## **process**\n\n\`\`\`\`md\n## rounds\n\`\`\`\``,
      visual,
    ).problems,
  ).toEqual([
    'drop the "review" section; keep declined or open findings, one line each',
    'drop the "process" section; keep declined or open findings, one line each',
  ]);
});
