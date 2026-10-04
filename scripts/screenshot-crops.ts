import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Visual, VisualRegion } from '../src/comparison-model';
import { sha256 } from '../src/encoding';
import { decodePng, encodeRgbPng, type RgbaImage } from '../src/png';

type Box = { x: number; y: number; width: number; height: number };

const margin = 24;
const smallest = { width: 360, height: 160 };
const biggest = { width: 960, height: 640 };
const gutter = 12;
const gutterColor = [208, 215, 222] as const;

function span(
  start: number,
  length: number,
  bounds: { smallest: number; largest: number },
  limit: number,
) {
  const size = Math.min(
    limit,
    bounds.largest,
    Math.max(length + 2 * margin, bounds.smallest),
  );
  const from = Math.round(start + length / 2 - size / 2);

  return [Math.min(Math.max(0, from), limit - size), size] as const;
}

// The region with a margin, grown to a readable size or cut to one that fits
// a comment, around its center and inside the screenshot.
export function cropWindow(
  image: { width: number; height: number },
  region: Box,
): Box {
  const [x, width] = span(
    region.x,
    region.width,
    { smallest: smallest.width, largest: biggest.width },
    image.width,
  );
  const [y, height] = span(
    region.y,
    region.height,
    { smallest: smallest.height, largest: biggest.height },
    image.height,
  );

  return { x, y, width, height };
}

function cut(image: RgbaImage, box: Box): RgbaImage {
  const rgba = new Uint8Array(box.width * box.height * 4);

  for (let row = 0; row < box.height; row += 1) {
    const from = ((box.y + row) * image.width + box.x) * 4;

    rgba.set(
      image.rgba.subarray(from, from + box.width * 4),
      row * box.width * 4,
    );
  }

  return { width: box.width, height: box.height, rgba };
}

// Each row's images side by side, rows stacked, separated by gutters.
export function arrange(rows: readonly (readonly RgbaImage[])[]): Uint8Array {
  const rowWidth = (row: readonly RgbaImage[]) =>
    row.reduce((sum, image) => sum + image.width, 0) +
    gutter * (row.length - 1);
  const rowHeight = (row: readonly RgbaImage[]) =>
    Math.max(...row.map((image) => image.height));
  const width = Math.max(...rows.map(rowWidth));
  const height =
    rows.reduce((sum, row) => sum + rowHeight(row), 0) +
    gutter * (rows.length - 1);
  const rgb = new Uint8Array(width * height * 3);

  for (let index = 0; index < width * height; index += 1) {
    rgb.set(gutterColor, index * 3);
  }

  let top = 0;

  for (const row of rows) {
    let left = 0;

    for (const image of row) {
      for (let y = 0; y < image.height; y += 1) {
        for (let x = 0; x < image.width; x += 1) {
          const from = (y * image.width + x) * 4;
          const to = ((top + y) * width + left + x) * 3;

          rgb.set(image.rgba.subarray(from, from + 3), to);
        }
      }

      left += image.width + gutter;
    }

    top += rowHeight(row) + gutter;
  }

  return encodeRgbPng(width, height, rgb);
}

type Read = { kind: 'read'; image: RgbaImage } | { kind: 'mismatch' | 'none' };

async function readImage(file: string, expected: string): Promise<Read> {
  const bytes = await readFile(file);

  if (sha256(bytes) !== expected) {
    return { kind: 'mismatch' };
  }

  const decoded = decodePng(bytes);

  return decoded.kind === 'decoded'
    ? { kind: 'read', image: decoded.image }
    : { kind: 'none' };
}

// The parts of a result the crops read.
type CropSide = {
  screenshot: string | null;
  capture: {
    manifest: { artifacts: readonly { id: string; sha256: string }[] };
  } | null;
};

type CropJourney = {
  title: string;
  base: CropSide;
  candidate: CropSide;
  comparison:
    { kind: 'available'; visual: Visual } | { kind: 'preview' | 'unavailable' };
};

function screenshotOf(
  directory: string,
  side: CropSide,
): [string, string] | null {
  const recorded = side.capture?.manifest.artifacts.find(
    (item) => item.id === 'screenshot',
  );

  return side.screenshot === null || recorded === undefined
    ? null
    : [path.join(directory, side.screenshot), recorded.sha256];
}

export type Crops =
  | { kind: 'image'; bytes: Uint8Array; altText: string }
  | { kind: 'mismatch' }
  | { kind: 'none' };

// Before, after and the difference image, cut around the largest changed
// region of each journey whose screenshots changed. One region only: a box
// around distant regions could show most of the page. Every image must still
// match the hash the run recorded.
export async function screenshotCrops(run: {
  directory: string;
  result: { journeys: readonly CropJourney[] };
}): Promise<Crops> {
  const rows: RgbaImage[][] = [];
  const titles: string[] = [];

  for (const journey of run.result.journeys) {
    const visual =
      journey.comparison.kind === 'available'
        ? journey.comparison.visual
        : null;
    const before = screenshotOf(run.directory, journey.base);
    const after = screenshotOf(run.directory, journey.candidate);

    if (visual?.kind !== 'changed' || before === null || after === null) {
      continue;
    }

    const images = [
      await readImage(...before),
      await readImage(...after),
      await readImage(
        path.join(run.directory, visual.diff.path),
        visual.diff.sha256,
      ),
    ];

    if (images.some((image) => image.kind === 'mismatch')) {
      return { kind: 'mismatch' };
    }

    const decoded = images.flatMap((image) =>
      image.kind === 'read' ? [image.image] : [],
    );
    const [largest]: readonly VisualRegion[] = visual.regions;

    if (decoded.length !== 3 || largest === undefined) {
      continue;
    }

    const box = cropWindow(visual, largest);

    rows.push(decoded.map((image) => cut(image, box)));
    titles.push(journey.title);
  }

  if (rows.length === 0) {
    return { kind: 'none' };
  }

  return {
    kind: 'image',
    bytes: arrange(rows),
    altText: `Before, after and changed pixels, left to right, around the largest changed region${titles.length === 1 ? '' : `. Rows: ${titles.join(', ')}`}`,
  };
}
