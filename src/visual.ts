import {
  maxVisualRegions,
  type Visual,
  type VisualRegion,
} from './comparison-model';
import { sha256 } from './encoding';
import { encodeRgbPng, type RgbaImage } from './png';

const visualThreshold = 0.1;
const maxYiqDelta = 35215;
const regionTile = 16;
// Blue and orange stay distinct under common color-vision deficiencies and
// carry no pass/fail meaning.
export const darker = [31, 95, 173];
export const lighter = [217, 115, 13];
const contextOpacity = 0.2;

type ChangedVisual = Extract<Visual, { kind: 'changed' }>;

export type PixelComparison =
  | { visual: ChangedVisual; diff: { path: string; bytes: Uint8Array } }
  | {
      visual: Exclude<Visual, { kind: 'changed' | 'unavailable' }>;
      diff: null;
    };

function blend(value: number, alpha: number): number {
  return 255 + ((value - 255) * alpha) / 255;
}

function luma(image: Uint8Array, at: number): number {
  const alpha = image[at + 3] ?? 255;

  return (
    blend(image[at] ?? 0, alpha) * 0.29889531 +
    blend(image[at + 1] ?? 0, alpha) * 0.58662247 +
    blend(image[at + 2] ?? 0, alpha) * 0.11448223
  );
}

// Squared YIQ distance from Kotsarenko and Ramos, "Measuring perceived color
// difference using YIQ NTSC transmission color space in mobile applications".
// Pixelmatch uses the same metric and threshold scale, so thresholds compare.
function colorDelta(left: Uint8Array, right: Uint8Array, at: number): number {
  const leftAlpha = left[at + 3] ?? 255;
  const rightAlpha = right[at + 3] ?? 255;
  const red =
    blend(left[at] ?? 0, leftAlpha) - blend(right[at] ?? 0, rightAlpha);
  const green =
    blend(left[at + 1] ?? 0, leftAlpha) - blend(right[at + 1] ?? 0, rightAlpha);
  const blue =
    blend(left[at + 2] ?? 0, leftAlpha) - blend(right[at + 2] ?? 0, rightAlpha);
  const y = red * 0.29889531 + green * 0.58662247 + blue * 0.11448223;
  const i = red * 0.59597799 - green * 0.2741761 - blue * 0.32180189;
  const q = red * 0.21147017 - green * 0.52261711 + blue * 0.31114694;

  return 0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q;
}

function regions(
  changed: Uint8Array,
  width: number,
  height: number,
): VisualRegion[] {
  const columns = Math.ceil(width / regionTile);
  const tileRows = Math.ceil(height / regionTile);
  const tiles = new Uint8Array(columns * tileRows);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (changed[y * width + x] === 1) {
        tiles[
          Math.floor(y / regionTile) * columns + Math.floor(x / regionTile)
        ] = 1;
      }
    }
  }

  const found: VisualRegion[] = [];
  const visited = new Uint8Array(tiles.length);

  for (let start = 0; start < tiles.length; start += 1) {
    if (tiles[start] !== 1 || visited[start] === 1) {
      continue;
    }

    const component: number[] = [];
    const pending = [start];
    visited[start] = 1;

    for (let tile = pending.pop(); tile !== undefined; tile = pending.pop()) {
      component.push(tile);
      const column = tile % columns;
      const row = Math.floor(tile / columns);

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const x = column + dx;
          const y = row + dy;
          const next = y * columns + x;

          if (
            x >= 0 &&
            y >= 0 &&
            x < columns &&
            y < tileRows &&
            tiles[next] === 1 &&
            visited[next] !== 1
          ) {
            visited[next] = 1;
            pending.push(next);
          }
        }
      }
    }

    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;
    let count = 0;

    for (const tile of component) {
      const x0 = (tile % columns) * regionTile;
      const y0 = Math.floor(tile / columns) * regionTile;

      for (let y = y0; y < Math.min(y0 + regionTile, height); y += 1) {
        for (let x = x0; x < Math.min(x0 + regionTile, width); x += 1) {
          if (changed[y * width + x] === 1) {
            count += 1;
            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x);
            bottom = Math.max(bottom, y);
          }
        }
      }
    }

    found.push({
      x: left,
      y: top,
      width: right - left + 1,
      height: bottom - top + 1,
      changedPixels: count,
    });
  }

  return found.sort(
    (first, second) => second.changedPixels - first.changedPixels,
  );
}

export function comparePixels(
  base: RgbaImage,
  candidate: RgbaImage,
): PixelComparison {
  if (base.width !== candidate.width || base.height !== candidate.height) {
    return {
      visual: {
        kind: 'size-differs',
        base: { width: base.width, height: base.height },
        candidate: { width: candidate.width, height: candidate.height },
      },
      diff: null,
    };
  }

  const { width, height } = base;
  const maxDelta = maxYiqDelta * visualThreshold * visualThreshold;
  const changed = new Uint8Array(width * height);
  const diff = new Uint8Array(width * height * 3);
  let differingPixels = 0;
  let changedPixels = 0;
  let left = width;
  let top = height;
  let right = 0;
  let bottom = 0;

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const at = pixel * 4;
    const same =
      base.rgba[at] === candidate.rgba[at] &&
      base.rgba[at + 1] === candidate.rgba[at + 1] &&
      base.rgba[at + 2] === candidate.rgba[at + 2] &&
      base.rgba[at + 3] === candidate.rgba[at + 3];

    if (!same) {
      const x = pixel % width;
      const y = Math.floor(pixel / width);

      differingPixels += 1;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }

    const after = luma(candidate.rgba, at);

    if (!same && colorDelta(base.rgba, candidate.rgba, at) > maxDelta) {
      changedPixels += 1;
      changed[pixel] = 1;
      diff.set(after < luma(base.rgba, at) ? darker : lighter, pixel * 3);
    } else {
      const faded = Math.round(255 + (after - 255) * contextOpacity);

      diff.set([faded, faded, faded], pixel * 3);
    }
  }

  if (differingPixels === 0) {
    return { visual: { kind: 'identical', width, height }, diff: null };
  }

  if (changedPixels === 0) {
    return {
      visual: {
        kind: 'below-threshold',
        width,
        height,
        threshold: visualThreshold,
        differingPixels,
        bounds: {
          x: left,
          y: top,
          width: right - left + 1,
          height: bottom - top + 1,
        },
      },
      diff: null,
    };
  }

  const [largest, ...others] = regions(changed, width, height);

  if (largest === undefined) {
    throw new Error('Changed pixels must form at least one region');
  }

  const diffImage = encodeRgbPng(width, height, diff);
  const path = 'visual-diff.png';

  return {
    visual: {
      kind: 'changed',
      width,
      height,
      threshold: visualThreshold,
      differingPixels,
      changedPixels,
      regionCount: others.length + 1,
      regions: [largest, ...others.slice(0, maxVisualRegions - 1)],
      diff: { path, sha256: sha256(diffImage) },
    },
    diff: { path, bytes: diffImage },
  };
}
