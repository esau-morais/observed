import { createGetUrl } from 'fumadocs-core/source';

export const appName = 'Observed';
export const docsRoute = '/docs';
export const siteUrl = 'https://observed.software';

export const gitConfig = {
  user: 'esau-morais',
  repo: 'observed',
  branch: 'main',
};

const getDocsUrl = createGetUrl(docsRoute);

export function getPageMarkdownUrl(page: { slugs: string[]; locale?: string | undefined }) {
  const segments = [...page.slugs];
  const last = segments.pop();
  segments.push(last === undefined ? 'index.md' : `${last}.md`);
  return { segments, url: getDocsUrl(segments, page.locale) };
}

/** @returns page slugs */
export function decodeMarkdownUrl(segments: string[]) {
  const out = [...segments];
  const last = out.pop();
  if (last === undefined) return out;
  const slug = last.replace(/\.md$/, '');
  if (out.length === 0 && slug === 'index') return out;
  out.push(slug);
  return out;
}
