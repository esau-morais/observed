import { expect, test } from 'vitest';
import { encodeGif, type GifFrame } from '../src/gif';

type Decoded = { delay: number; rgb: number[] };

// A reader for the subset the encoder writes: one global palette, graphic
// control blocks, and frames drawn over the previous one.
function decode(bytes: Uint8Array): { width: number; frames: Decoded[] } {
  let at = 6;
  const byte = () => bytes[at++] ?? 0;
  const word = () => byte() | (byte() << 8);
  const width = word();
  const height = word();
  const packed = byte();

  at += 2;

  const colors = 1 << ((packed & 7) + 1);
  const table: number[][] = [];

  for (let index = 0; index < colors; index++) {
    table.push([byte(), byte(), byte()]);
  }

  const canvas = new Array<number>(width * height * 3).fill(0);
  const frames: Decoded[] = [];
  let delay = 0;

  for (;;) {
    const block = byte();

    if (block === 0x3b) {
      return { width, frames };
    }

    if (block === 0x21) {
      const label = byte();

      if (label === 0xf9) {
        at += 2;
        delay = word() * 10;
        at += 2;
      } else {
        for (let size = byte(); size > 0; size = byte()) {
          at += size;
        }
      }

      continue;
    }

    const left = word();
    const top = word();
    const frameWidth = word();
    const frameHeight = word();

    at += 1;

    const minimum = byte();
    const data: number[] = [];

    for (let size = byte(); size > 0; size = byte()) {
      for (let index = 0; index < size; index++) {
        data.push(byte());
      }
    }

    const clear = 1 << minimum;
    const end = clear + 1;
    let size = minimum + 1;
    let dictionary: number[][] = [];
    const reset = () => {
      dictionary = Array.from({ length: end + 1 }, (_, code) => [code]);
      size = minimum + 1;
    };

    const indices: number[] = [];
    let previous: number[] | null = null;
    let bit = 0;

    reset();

    for (;;) {
      let code = 0;

      for (let index = 0; index < size; index++, bit++) {
        code |= (((data[bit >> 3] ?? 0) >> (bit & 7)) & 1) << index;
      }

      if (code === clear) {
        reset();
        previous = null;
        continue;
      }

      if (code === end) {
        break;
      }

      const known = dictionary[code];
      const entry: number[] =
        known ?? (previous === null ? [] : [...previous, previous[0] ?? 0]);

      indices.push(...entry);

      if (previous !== null) {
        dictionary.push([...previous, entry[0] ?? 0]);
      }

      if (dictionary.length === 1 << size && size < 12) {
        size++;
      }

      previous = entry;
    }

    for (const [pixel, index] of indices.entries()) {
      const x = left + (pixel % frameWidth);
      const y = top + Math.floor(pixel / frameWidth);

      canvas.splice((y * width + x) * 3, 3, ...(table[index] ?? []));
    }

    expect(indices).toHaveLength(frameWidth * frameHeight);
    frames.push({ delay, rgb: [...canvas] });
  }
}

function frame(
  width: number,
  height: number,
  delay: number,
  color: (x: number, y: number) => [number, number, number],
): GifFrame {
  const rgba = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      rgba.set([...color(x, y), 255], (y * width + x) * 4);
    }
  }

  return { width, height, rgba, delay };
}

function rgb(input: GifFrame): number[] {
  return [...input.rgba].filter((_, index) => index % 4 !== 3);
}

// Fails if code widths grow at the wrong point, the table does not restart
// at 4096 codes, or a changed rectangle lands in the wrong place.
test('frames decode to the pixels they were made from, with unchanged frames merged', () => {
  const noise = (x: number, y: number): [number, number, number] => {
    const value = (x * 37 + y * 91 + ((x * y) % 7) * 13) % 200;

    return [value, (value * 3) % 256, (value * 7) % 256];
  };

  const first = frame(120, 90, 100, noise);
  const second = frame(120, 90, 250, (x, y) =>
    x > 40 && x < 70 && y > 20 && y < 50 ? [255, 0, 0] : noise(x, y),
  );
  const repeat = { ...second, delay: 750 };
  const decoded = decode(encodeGif([first, second, repeat]));

  expect(decoded.frames.map((item) => item.delay)).toEqual([100, 1000]);
  expect(decoded.frames[0]?.rgb).toEqual(rgb(first));
  expect(decoded.frames[1]?.rgb).toEqual(rgb(second));
});
