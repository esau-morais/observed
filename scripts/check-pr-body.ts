import { readFile } from 'node:fs/promises';

const wordLimit = 150;
const headingLimit = 2;
const visualStart = /^(!\[|<img\s|<picture|<video|```mermaid)/i;
const fileLine =
  /^\s*[-*]\s+`?[\w./-]+\.(ts|tsx|js|md|yml|yaml|json)`?\s*($|[:(—-])/gm;
const processSections = ['review', 'process', 'rounds'];

// A before | after table counts as a visual when its cells hold images.
function opensWithVisual(body: string) {
  const first = body
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .find((block) => block !== '');

  if (first === undefined) {
    return false;
  }

  return (
    visualStart.test(first) ||
    (first.startsWith('|') && /!\[|<img\s/i.test(first))
  );
}

function proseWords(body: string) {
  return body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`[^`]*`/g, 'x')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .split(/\s+/)
    .filter((word) => /[a-z0-9]/i.test(word)).length;
}

export function checkPrBody(body: string, options: { visual: boolean }) {
  const problems: string[] = [];

  if (options.visual && !opensWithVisual(body)) {
    problems.push(
      'open with a visual: a screenshot, a before | after image, the rendered Observed comment, a GIF, or a ```mermaid diagram of the flow or decision',
    );
  }

  const words = proseWords(body);

  if (words > wordLimit) {
    problems.push(
      `prose is ${words} words; cut to ${wordLimit}. say what changed for people and the evidence, nothing else`,
    );
  }

  const headings = body.match(/^#{1,6}\s/gm)?.length ?? 0;

  if (headings > headingLimit) {
    problems.push(
      `${headings} headings; use at most ${headingLimit} (checks, not verified)`,
    );
  }

  const files = body.match(fileLine)?.length ?? 0;

  if (files > 0) {
    problems.push(`${files} lines narrate files; the diff shows those`);
  }

  for (const section of processSections) {
    if (new RegExp(`^#{1,6}\\s*${section}\\b`, 'im').test(body)) {
      problems.push(
        `drop the "${section}" section; keep only declined findings, in one line`,
      );
    }
  }

  return { words, problems };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const file = args.find((arg) => !arg.startsWith('--'));

  if (file === undefined) {
    console.error(
      'Usage: bun run check:pr-body <body.md> [--no-visual]\n--no-visual is only for release and pin PRs, which have nothing to show.',
    );
    process.exit(64);
  }

  const result = checkPrBody(await readFile(file, 'utf8'), {
    visual: !args.includes('--no-visual'),
  });

  if (result.problems.length > 0) {
    console.error(result.problems.map((problem) => `- ${problem}`).join('\n'));
    process.exit(1);
  }

  console.log(`ok: ${result.words} words of prose`);
}
