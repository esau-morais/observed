import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'vitest';

// The judge decides verdicts with code alone, so it may depend only on Effect,
// Node built-ins and its own modules. A model SDK here would let a model
// influence a verdict.
test('the judge depends on nothing but Effect, Node built-ins and itself', async () => {
  const root = import.meta.dirname;
  const manifest: unknown = JSON.parse(
    await readFile(path.join(root, '..', 'package.json'), 'utf8'),
  );
  const files = (await readdir(root, { recursive: true })).filter(
    (file) => /\.[cm]?[jt]sx?$/.test(file) && !/\.test\.[jt]sx?$/.test(file),
  );
  const specifiers = await Promise.all(
    files.map(async (file) => {
      const source = await readFile(path.join(root, file), 'utf8');

      return [...source.matchAll(/(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"`]([^'"`]+)['"`]/g)].map(
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
  expect(manifest).toMatchObject({ dependencies: { effect: expect.any(String) as unknown } });
  expect(Object.keys((manifest as { dependencies: Record<string, string> }).dependencies)).toEqual([
    'effect',
  ]);
});
