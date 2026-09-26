import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { expect, test } from 'vitest';
import { decodePng, type RgbaImage } from '../src/png';
import { comparePixels } from '../src/visual';
import { describeVisual } from '../src/visual-text';

type Chunk = [type: string, data: Uint8Array];

function chunk([type, data]: Chunk): Uint8Array {
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length, 0);
  output.write(type, 4, 'latin1');
  output.set(data, 8);
  output.writeUInt32BE(
    crc32(output.subarray(4, data.length + 8)),
    data.length + 8,
  );

  return output;
}

function header(
  width: number,
  height: number,
  colorType = 2,
  { bitDepth = 8, interlace = 0 } = {},
): Chunk {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data.set([bitDepth, colorType, 0, 0, interlace], 8);

  return ['IHDR', data];
}

function png(chunks: Chunk[]): Uint8Array {
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    ...chunks.map(chunk),
  ]);
}

function predictor(filter: number, left: number, up: number, upLeft: number) {
  switch (filter) {
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return (left + up) >> 1;
    case 4: {
      const estimate = left + up - upLeft;
      const distances = [left, up, upLeft].map((value) =>
        Math.abs(estimate - value),
      );
      const [toLeft = 0, toUp = 0, toUpLeft = 0] = distances;
      if (toLeft <= toUp && toLeft <= toUpLeft) {
        return left;
      }

      return toUp <= toUpLeft ? up : upLeft;
    }
    default:
      return 0;
  }
}

// Independent forward filter so decoding is checked against the PNG
// specification rather than against the decoder's own output.
function filtered(
  raw: Uint8Array,
  width: number,
  height: number,
  channels: number,
  filter: number,
): Uint8Array {
  const stride = width * channels;
  const output = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    output[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x += 1) {
      const at = y * stride + x;
      const left = x >= channels ? (raw[at - channels] ?? 0) : 0;
      const up = y > 0 ? (raw[at - stride] ?? 0) : 0;
      const upLeft =
        y > 0 && x >= channels ? (raw[at - stride - channels] ?? 0) : 0;
      output[y * (stride + 1) + 1 + x] =
        ((raw[at] ?? 0) - predictor(filter, left, up, upLeft)) & 0xff;
    }
  }

  return output;
}

function noise(length: number, seed: number): Uint8Array {
  const values = new Uint8Array(length);
  let state = seed;
  for (let index = 0; index < length; index += 1) {
    state = (state * 1103515245 + 12345) >>> 0;
    values[index] = state >>> 24;
  }

  return values;
}

function image(width: number, height: number, rgb: number[][]): RgbaImage {
  return {
    width,
    height,
    rgba: new Uint8Array(rgb.flatMap((pixel) => [...pixel, 255])),
  };
}

const width = 5;
const height = 4;

test.each([
  [2, 0],
  [2, 1],
  [2, 2],
  [2, 3],
  [2, 4],
  [6, 0],
  [6, 4],
])(
  'decodes color type %i with row filter %i to the original pixels',
  (colorType, filter) => {
    const channels = colorType === 6 ? 4 : 3;
    const raw = noise(width * height * channels, colorType * 10 + filter);
    const decoded = decodePng(
      png([
        header(width, height, colorType),
        ['IDAT', deflateSync(filtered(raw, width, height, channels, filter))],
        ['IEND', new Uint8Array()],
      ]),
    );

    const expected =
      channels === 4
        ? raw
        : new Uint8Array(
            Array.from({ length: width * height }, (_, pixel) => [
              raw[pixel * 3] ?? 0,
              raw[pixel * 3 + 1] ?? 0,
              raw[pixel * 3 + 2] ?? 0,
              255,
            ]).flat(),
          );

    expect(decoded).toEqual({
      kind: 'decoded',
      image: { width, height, rgba: expected },
    });
  },
);

test('decodes image data split across chunks and skips ancillary chunks', () => {
  const data = deflateSync(filtered(noise(60, 7), 5, 4, 3, 1));
  const decoded = decodePng(
    png([
      header(5, 4),
      ['tEXt', Buffer.from('Comment\0synthetic')],
      ['IDAT', data.subarray(0, 10)],
      ['IDAT', data.subarray(10)],
      ['IEND', new Uint8Array()],
    ]),
  );

  expect(decoded.kind).toBe('decoded');
});

const valid = png([
  header(2, 2),
  ['IDAT', deflateSync(new Uint8Array(14))],
  ['IEND', new Uint8Array()],
]);

const badCrc = Uint8Array.from(valid);
badCrc[29] = (badCrc[29] ?? 0) ^ 1;

test.each([
  [
    'not a PNG',
    new TextEncoder().encode('synthetic image bytes'),
    'Not a PNG file',
  ],
  ['truncated', valid.subarray(0, valid.length - 6), 'truncated'],
  ['bad CRC', badCrc, 'CRC'],
  [
    'palette',
    png([
      header(2, 2, 3),
      ['PLTE', new Uint8Array(3)],
      ['IEND', new Uint8Array()],
    ]),
    'expected 8-bit RGB or RGBA',
  ],
  [
    '16-bit',
    png([header(2, 2, 2, { bitDepth: 16 }), ['IEND', new Uint8Array()]]),
    'expected 8-bit RGB or RGBA',
  ],
  [
    'interlaced',
    png([header(2, 2, 2, { interlace: 1 }), ['IEND', new Uint8Array()]]),
    'Interlaced',
  ],
  [
    'oversized dimensions',
    png([header(16_384, 16_384), ['IEND', new Uint8Array()]]),
    'outside the supported',
  ],
  [
    'data larger than its header',
    png([
      header(2, 2),
      ['IDAT', deflateSync(new Uint8Array(1_000_000))],
      ['IEND', new Uint8Array()],
    ]),
    'larger than its header',
  ],
  [
    'data smaller than its header',
    png([
      header(2, 2),
      ['IDAT', deflateSync(new Uint8Array(13))],
      ['IEND', new Uint8Array()],
    ]),
    'does not match its header',
  ],
  [
    'invalid row filter',
    png([
      header(2, 2),
      [
        'IDAT',
        deflateSync(new Uint8Array([5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])),
      ],
      ['IEND', new Uint8Array()],
    ]),
    'row filter',
  ],
  ['trailing bytes', Buffer.concat([valid, Buffer.from('x')]), 'after IEND'],
  [
    'transparency key',
    png([
      header(2, 2),
      ['tRNS', new Uint8Array(6)],
      ['IDAT', deflateSync(new Uint8Array(14))],
      ['IEND', new Uint8Array()],
    ]),
    'tRNS chunk changes colors',
  ],
  [
    'unknown critical chunk',
    png([header(2, 2), ['ABCD', new Uint8Array()], ['IEND', new Uint8Array()]]),
    'critical chunk ABCD',
  ],
] as const)(
  'rejects %s input instead of guessing pixels',
  (_name, bytes, reason) => {
    const decoded = decodePng(bytes);

    expect(decoded.kind).toBe('unsupported');
    expect(decoded.kind === 'unsupported' ? decoded.reason : '').toContain(
      reason,
    );
  },
);

const fixtures = path.join(import.meta.dirname, 'fixtures/screenshots');

async function screenshot(name: string): Promise<RgbaImage> {
  const decoded = decodePng(await readFile(path.join(fixtures, name)));

  if (decoded.kind !== 'decoded') {
    throw new Error(`Fixture ${name} did not decode: ${decoded.reason}`);
  }

  return decoded.image;
}

test('a Chromium re-render of the same UI stays below the threshold while a heading change is located', async () => {
  const base = await screenshot('base.png');

  expect(
    comparePixels(base, await screenshot('duplicate-request.png')).visual,
  ).toEqual({
    kind: 'below-threshold',
    width: 1120,
    height: 800,
    threshold: 0.1,
    differingPixels: 8,
    bounds: { x: 853, y: 64, width: 5, height: 2 },
  });

  const heading = comparePixels(base, await screenshot('heading-change.png'));

  expect(heading.visual).toMatchObject({
    kind: 'changed',
    changedPixels: 2747,
    regionCount: 1,
    regions: [{ x: 286, y: 129, width: 205, height: 29 }],
  });
  expect(heading.diff?.path).toBe('visual-diff.png');
});

test('reports differing dimensions instead of comparing overlapping pixels', () => {
  expect(
    comparePixels(
      image(1, 1, [[255, 255, 255]]),
      image(2, 1, [
        [255, 255, 255],
        [255, 255, 255],
      ]),
    ).visual,
  ).toEqual({
    kind: 'size-differs',
    base: { width: 1, height: 1 },
    candidate: { width: 2, height: 1 },
  });
});

test('separates distant changes into regions and keeps the count when listing is capped', () => {
  const size = 16 * 24;
  const rgb = Array.from({ length: size * 16 }, () => [255, 255, 255]);
  const changed = rgb.map((pixel, index) =>
    (index % size) % 32 === 0 ? [0, 0, 0] : pixel,
  );
  const result = comparePixels(
    image(size, 16, rgb),
    image(size, 16, changed),
  ).visual;

  expect(result).toMatchObject({ kind: 'changed', regionCount: 12 });

  const regions = result.kind === 'changed' ? result.regions : [];

  expect(regions).toHaveLength(10);
  expect(regions[0]).toEqual({
    x: 0,
    y: 0,
    width: 1,
    height: 16,
    changedPixels: 16,
  });
});

test('a uniform shift under the threshold still reports how many pixels differ and where', () => {
  const white = Array.from({ length: 100 * 100 }, () => [255, 255, 255]);
  const gray = white.map(() => [230, 230, 230]);
  const { visual } = comparePixels(
    image(100, 100, white),
    image(100, 100, gray),
  );

  expect(visual).toMatchObject({
    kind: 'below-threshold',
    differingPixels: 10_000,
    bounds: { x: 0, y: 0, width: 100, height: 100 },
  });
  expect(describeVisual(visual)).toBe(
    '10,000 pixels (100.00%) differ within 100 × 100 px at x 0, y 0. None exceed the 0.1 color threshold.',
  );
});
