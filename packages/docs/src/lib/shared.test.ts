import { expect, it } from 'vitest';
import { decodeMarkdownUrl, getPageMarkdownUrl } from './shared';

it('maps a page to its markdown URL and back', () => {
  for (const slugs of [[], ['concepts'], ['agents', 'codex']]) {
    const { segments } = getPageMarkdownUrl({ slugs });
    expect(decodeMarkdownUrl(segments)).toEqual(slugs);
  }
});
