import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { meta, siteUrl } from './meta';

it('points link previews at an image the site serves', () => {
  const image = meta.find((tag) => 'property' in tag && tag.property === 'og:image');
  const path = image?.content?.replace(siteUrl, '') ?? '';
  expect(path).toBe('/og.png');
  expect(existsSync(fileURLToPath(new URL(`../public${path}`, import.meta.url)))).toBe(true);
});
