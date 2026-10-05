import { readFile } from 'node:fs/promises';

const wordLimit = 150;
const headingLimit = 2;
const fence = /^ {0,3}(```|~~~)[\s\S]*?^ {0,3}\1/gm;
const image = /!\[[^\]]*\]\([^)\s]+(\s+"[^"]*")?\)|<img\s[^>]*\bsrc=/i;
const tableDelimiter =
  /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)+\|?[ \t]*$/;
const fileLine =
  /^[ \t]*([-*+]|\d+[.)])[ \t]+`?[\w./-]+\.[a-z][a-z0-9]{0,4}`?(?=[\s:(,—-]|$)/gim;
const processSections = ['review', 'process', 'rounds'];

function opensWithVisual(body: string) {
  const first = body
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .find((block) => block !== '');

  if (first === undefined) {
    return false;
  }

  const unwrapped = first.replace(/^(\[|<(a|p|div)\b[^>]*>\s*)/i, '');
  const second = first.split('\n')[1];

  return (
    /^(```|~~~)mermaid\b/i.test(first) ||
    /^<(picture|video)\b/i.test(unwrapped) ||
    new RegExp(`^(${image.source})`, 'i').test(unwrapped) ||
    (second !== undefined && tableDelimiter.test(second) && image.test(first))
  );
}

function headings(text: string) {
  const lines = text.split(/\r?\n/);

  return lines.flatMap((line, index) => {
    const atx = /^ {0,3}#{1,6}(?:[ \t]+(.*))?$/.exec(line);

    if (atx !== null) {
      return [atx[1] ?? ''];
    }

    const previous = lines[index - 1]?.trim() ?? '';
    const setext =
      /^ {0,3}(=+|-+)[ \t]*$/.test(line) &&
      previous !== '' &&
      !/^([-*+>|#]|\d+[.)])/.test(previous);

    return setext ? [previous] : [];
  });
}

function proseWords(text: string) {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(new RegExp(image.source, 'gi'), ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`[^`]*`/g, 'x')
    .split(/\r?\n/)
    .filter((line) => !tableDelimiter.test(line))
    .join('\n')
    .replace(/\|/g, ' ')
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

  const text = body.replace(fence, ' ');
  const words = proseWords(text);

  if (words > wordLimit) {
    problems.push(
      `prose is ${words} words; cut to ${wordLimit}. say what changed for people and the evidence, nothing else`,
    );
  }

  const titles = headings(text);

  if (titles.length > headingLimit) {
    problems.push(
      `${titles.length} headings; use at most ${headingLimit} (checks, not verified)`,
    );
  }

  const files = text.match(fileLine)?.length ?? 0;

  if (files > 0) {
    problems.push(`${files} lines narrate files; the diff shows those`);
  }

  for (const section of processSections) {
    if (titles.some((title) => new RegExp(`^${section}\\b`, 'i').test(title))) {
      problems.push(
        `drop the "${section}" section; keep declined or open findings, one line each`,
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
