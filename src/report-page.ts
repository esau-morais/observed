import { Effect } from 'effect';
import { createHash } from 'node:crypto';
import { preloadReport, ViewFailure, type Asset } from './view';
import { embeddedEvidenceId, embeddedResultId } from './viewer/embedded';

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function hashSource(source: string): string {
  return `'sha256-${createHash('sha256').update(source).digest('base64')}'`;
}

const onlyAsset = Effect.fnUntraced(function* (
  assets: Map<string, Asset>,
  extension: string,
) {
  const matches = [...assets].filter(
    ([key]) => key.startsWith('/assets/') && key.endsWith(extension),
  );

  if (matches.length !== 1 || matches[0] === undefined) {
    return yield* new ViewFailure({
      message: `The report page needs exactly one viewer ${extension} file; found ${String(matches.length)}`,
    });
  }

  return new TextDecoder().decode(matches[0][1].bytes);
});

const inlineFonts = Effect.fnUntraced(function* (
  css: string,
  assets: Map<string, Asset>,
) {
  const fonts = new Map<string, string>();

  for (const [, name = ''] of css.matchAll(/url\(\.\/([^)]+)\)/g)) {
    const font = assets.get(`/assets/${name}`);

    if (font === undefined) {
      return yield* new ViewFailure({
        message: `Viewer stylesheet references a missing asset: ${name}`,
      });
    }

    fonts.set(name, `data:${font.type};base64,${base64(font.bytes)}`);
  }

  return css.replace(
    /url\(\.\/([^)]+)\)/g,
    (match, name: string) => `url(${fonts.get(name) ?? match})`,
  );
});

// Unzipped workflow artifacts are served from a storage origin shared by
// every repository, with no Content-Security-Policy of their own.
export const renderReportPage = Effect.fn('renderReportPage')(function* (
  directory: string,
) {
  const assets = yield* preloadReport(directory);
  const script = yield* onlyAsset(assets, '.js');
  const style = yield* inlineFonts(yield* onlyAsset(assets, '.css'), assets);

  if (/<\/script|<!--/i.test(script) || /<\/style/i.test(style)) {
    return yield* new ViewFailure({
      message: 'The viewer build cannot be inlined into an HTML page',
    });
  }

  const result = assets.get('/result.json');

  if (result === undefined) {
    return yield* new ViewFailure({ message: 'The report holds no result' });
  }

  const resultText = new TextDecoder().decode(result.bytes);
  const evidence = Object.fromEntries(
    [...assets]
      .filter(([, asset]) => asset.evidence)
      .map(([key, asset]) => [
        key,
        { type: asset.type, data: base64(asset.bytes) },
      ]),
  );
  const policy = [
    "default-src 'none'",
    `script-src ${hashSource(script)}`,
    `style-src ${hashSource(style)}`,
    'font-src data:',
    'img-src data: blob:',
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'none'",
  ].join('; ');

  const page = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8">',
    `<meta http-equiv="Content-Security-Policy" content="${policy}">`,
    '<meta name="referrer" content="no-referrer">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<meta name="color-scheme" content="light dark">',
    '<title>Observed | Comparison report</title>',
    `<style>${style}</style>`,
    '</head>',
    '<body>',
    '<div id="root"></div>',
    '<noscript>This Observed report needs JavaScript.</noscript>',
    `<script type="application/json" id="${embeddedResultId}">${resultText.replaceAll('<', '\\u003c')}</script>`,
    `<script type="application/json" id="${embeddedEvidenceId}">${JSON.stringify(evidence).replaceAll('<', '\\u003c')}</script>`,
    `<script type="module">${script}</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');

  return { page, result: resultText };
});
