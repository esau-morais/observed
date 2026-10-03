import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { cropWindow, screenshotCrops } from '../scripts/screenshot-crops';
import { sha256 } from '../src/encoding';
import { decodePng, encodeRgbPng } from '../src/png';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

test('a crop keeps a changed region inside the screenshot and at a size a comment can show', () => {
  expect(
    cropWindow(
      { width: 400, height: 300 },
      { x: 390, y: 290, width: 10, height: 10 },
    ),
  ).toEqual({ x: 40, y: 140, width: 360, height: 160 });
  expect(
    cropWindow(
      { width: 200, height: 100 },
      { x: 0, y: 0, width: 200, height: 100 },
    ),
  ).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  expect(
    cropWindow(
      { width: 1280, height: 4000 },
      { x: 0, y: 0, width: 1280, height: 4000 },
    ),
  ).toEqual({ x: 160, y: 1680, width: 960, height: 640 });
});

function solid(value: number): Uint8Array {
  return encodeRgbPng(400, 300, new Uint8Array(400 * 300 * 3).fill(value));
}

// The comment shows these crops as evidence, so a screenshot whose bytes
// differ from the recorded hash must never be shown.
test('crops show before, after and difference side by side, and nothing once a screenshot no longer matches its hash', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'observed-crops-'));
  directories.push(directory);
  const images = { before: solid(10), after: solid(200), diff: solid(120) };

  for (const [name, bytes] of Object.entries(images)) {
    await writeFile(path.join(directory, `${name}.png`), bytes);
  }

  const side = (file: string, bytes: Uint8Array) => ({
    screenshot: file,
    capture: {
      manifest: { artifacts: [{ id: 'screenshot', sha256: sha256(bytes) }] },
    },
  });
  const result = {
    journeys: [
      {
        title: 'Load items',
        base: side('before.png', images.before),
        candidate: side('after.png', images.after),
        comparison: {
          kind: 'available',
          visual: {
            kind: 'changed',
            width: 400,
            height: 300,
            threshold: 0.1,
            differingPixels: 800,
            changedPixels: 800,
            regionCount: 1,
            regions: [
              { x: 20, y: 20, width: 40, height: 20, changedPixels: 800 },
            ],
            diff: { path: 'diff.png', sha256: sha256(images.diff) },
          },
        },
      },
    ],
  } as const;

  const crops = await screenshotCrops({ directory, result });

  if (crops.kind !== 'image') {
    throw new Error(`Expected an image, got ${crops.kind}`);
  }

  const decoded = decodePng(crops.bytes);

  if (decoded.kind !== 'decoded') {
    throw new Error('The crops are not a readable PNG');
  }

  const { width, rgba } = decoded.image;
  const red = (x: number) => rgba[x * 4];

  expect([width, decoded.image.height]).toEqual([360 * 3 + 12 * 2, 160]);
  expect([red(0), red(360 + 12), red(2 * (360 + 12))]).toEqual([10, 200, 120]);

  await writeFile(path.join(directory, 'after.png'), solid(201));

  expect(await screenshotCrops({ directory, result })).toEqual({
    kind: 'mismatch',
  });
});
