import { readFile } from 'node:fs/promises';

const wordLimit = 150;
const headingLimit = 2;
const processSections = ['review', 'process', 'rounds'];

// Bun.markdown parses GitHub Flavored Markdown; its callbacks return strings,
// so each top-level block is wrapped in private-use markers to find the first.
const open = '\uE000';
const split = '\uE001';
const close = '\uE002';
const imageMark = '\uE003';
const blockMark = new RegExp(`${open}\\w+${split}|[${open}-${imageMark}]`, 'g');

const source = String.raw`\ssrc(set)?\s*=\s*("[^"\s]+"|'[^'\s]+'|[^\s"'>]+)`;
const htmlImage = new RegExp(String.raw`<(img|video)\b[^>]*?${source}`, 'i');
const htmlVisual = new RegExp(
  String.raw`^\s*(<(a|p|div|picture)\b[^>]*>\s*)*<(img|video|source)\b[^>]*?${source}`,
  'i',
);
const fileExtensions = new Set(
  'ts tsx js jsx mjs cjs json jsonc md mdx yml yaml toml css scss html sh lock graphql gql properties txt svg png gif py go rs sql env'.split(
    ' ',
  ),
);
const fileNames = new Set([
  'Dockerfile',
  'Makefile',
  'LICENSE',
  'README',
  'CHANGELOG',
]);

function narratesFile(item: string) {
  const token = /^[\s`"'*_[]*([^\s`"'*_:,()\]]+)/.exec(item)?.[1] ?? '';
  const name = token.split('/').at(-1) ?? '';
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();

  return (
    fileNames.has(name) ||
    /^\.[\w-]+$/.test(name) ||
    (extension !== undefined && fileExtensions.has(extension))
  );
}

function parse(body: string) {
  const headings: string[] = [];
  const labels: string[] = [];
  const items: string[] = [];
  const block = (kind: string, content: string) =>
    `${open}${kind}${split}${content}${close}`;
  const text = (content: string) =>
    content
      .replace(blockMark, ' ')
      .replace(/<[^>]+>/g, ' ')
      .trim();

  const output = Bun.markdown.render(body, {
    heading: (children) => {
      headings.push(text(children));

      return block('heading', children);
    },
    paragraph: (children) => block('paragraph', children),
    blockquote: (children) => block('blockquote', children),
    list: (children) => block('list', children),
    listItem: (children) => {
      items.push(text(children));

      return ` ${children} `;
    },
    table: (children) => block('table', children),
    th: (children) => ` ${children} `,
    td: (children) => ` ${children} `,
    hr: () => block('hr', ''),
    code: (_children, meta) =>
      block(meta?.language === 'mermaid' ? 'mermaid' : 'code', ''),
    html: (children) => {
      const visible = children.replace(/<!--[\s\S]*?-->/g, '');

      for (const [, level, label = ''] of visible.matchAll(
        /<(h[1-6]|summary)\b[^>]*>([\s\S]*?)<\/\1>/gi,
      )) {
        (level?.toLowerCase() === 'summary' ? labels : headings).push(
          text(label),
        );
      }

      return visible.trim() === '' ? '' : block('html', visible);
    },
    image: (_children, meta) => (meta.src.trim() === '' ? '' : imageMark),
    codespan: (children) => children.replace(/\s+/g, '_'),
    link: (children) => children,
  });

  const first = new RegExp(`^\\s*${open}(\\w+)${split}([^${close}]*)`).exec(
    output,
  );

  return {
    first: { kind: first?.[1] ?? '', content: first?.[2] ?? '' },
    headings,
    labels,
    items,
    words: text(output)
      .split(/\s+/)
      .filter((word) => /[a-z0-9]/i.test(word)).length,
  };
}

function opensWithVisual(first: { kind: string; content: string }) {
  switch (first.kind) {
    case 'mermaid':
      return true;
    case 'paragraph':
      return (
        first.content.trimStart().startsWith(imageMark) ||
        htmlVisual.test(first.content)
      );
    case 'table':
      return first.content.includes(imageMark) || htmlImage.test(first.content);
    case 'html':
      return htmlVisual.test(first.content);
    default:
      return false;
  }
}

export function checkPrBody(body: string, options: { visual: boolean }) {
  const problems: string[] = [];
  const parsed = parse(body);

  if (options.visual && !opensWithVisual(parsed.first)) {
    problems.push(
      'open with a visual: a screenshot, a before | after image, the rendered Observed comment, a GIF, or a ```mermaid diagram of the flow or decision',
    );
  }

  if (parsed.words > wordLimit) {
    problems.push(
      `prose is ${parsed.words} words; cut to ${wordLimit}. say what changed for people and the evidence, nothing else`,
    );
  }

  if (parsed.headings.length > headingLimit) {
    problems.push(
      `${parsed.headings.length} headings; use at most ${headingLimit} (checks, not verified)`,
    );
  }

  const files = parsed.items.filter(narratesFile).length;

  if (files > 0) {
    problems.push(`${files} lines narrate files; the diff shows those`);
  }

  for (const section of processSections) {
    if (
      [...parsed.headings, ...parsed.labels].some((label) =>
        new RegExp(`^${section}\\b`, 'i').test(label),
      )
    ) {
      problems.push(
        `drop the "${section}" section; keep declined or open findings, one line each`,
      );
    }
  }

  return { words: parsed.words, problems };
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
