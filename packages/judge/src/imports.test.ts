import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'vitest';

// The judge decides verdicts with code alone, so it may import only Effect,
// Node built-ins and its own modules. A model SDK here would let a model
// influence a verdict.
test('the judge imports nothing but Effect, Node built-ins and itself', async () => {
  const root = import.meta.dirname;
  const files = (await readdir(root, { recursive: true })).filter(
    (file) => file.endsWith('.ts') && !file.endsWith('.test.ts'),
  );
  const specifiers = await Promise.all(
    files.map(async (file) => {
      const source = await readFile(path.join(root, file), 'utf8');

      return [...source.matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)].map(
        (match) => match[1] ?? '',
      );
    }),
  );
  const external = specifiers
    .flat()
    .filter(
      (specifier) =>
        !specifier.startsWith('.') && !specifier.startsWith('node:') && specifier !== 'effect',
    );

  expect(files.length).toBeGreaterThan(0);
  expect(external).toEqual([]);
});
