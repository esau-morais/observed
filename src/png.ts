import { crc32, deflateSync, inflateSync } from 'node:zlib';

export type RgbaImage = {
  width: number;
  height: number;
  rgba: Uint8Array;
};

export type DecodedPng =
  | { kind: 'decoded'; image: RgbaImage }
  | { kind: 'unsupported'; reason: string };

const maxPngSide = 16_384;
const maxPngPixels = 25_000_000;

const signature = [137, 80, 78, 71, 13, 10, 26, 10];

const channelsByColorType: Partial<Record<number, number>> = { 2: 3, 6: 4 };

function unsupported(reason: string): DecodedPng {
  return { kind: 'unsupported', reason };
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);

  if (toLeft <= toUp && toLeft <= toUpLeft) {
    return left;
  }

  return toUp <= toUpLeft ? up : upLeft;
}

function unfilter(
  data: Uint8Array,
  width: number,
  height: number,
  channels: number,
): Uint8Array | null {
  const stride = width * channels;
  const rows = new Uint8Array(stride * height);

  for (let y = 0; y < height; y += 1) {
    const source = y * (stride + 1);
    const filter = data[source];

    if (filter === undefined || filter > 4) {
      return null;
    }

    const row = y * stride;
    const above = row - stride;

    for (let x = 0; x < stride; x += 1) {
      const raw = data[source + 1 + x] ?? 0;
      const left = x >= channels ? (rows[row + x - channels] ?? 0) : 0;
      const up = y > 0 ? (rows[above + x] ?? 0) : 0;
      const upLeft =
        y > 0 && x >= channels ? (rows[above + x - channels] ?? 0) : 0;

      switch (filter) {
        case 0:
          rows[row + x] = raw;
          break;
        case 1:
          rows[row + x] = raw + left;
          break;
        case 2:
          rows[row + x] = raw + up;
          break;
        case 3:
          rows[row + x] = raw + ((left + up) >> 1);
          break;
        default:
          rows[row + x] = raw + paeth(left, up, upLeft);
      }
    }
  }

  return rows;
}

// Accepts only the PNG shape Chromium screenshots use: 8-bit RGB or RGBA,
// non-interlaced. Anything else is reported instead of guessed at.
export function decodePng(bytes: Uint8Array): DecodedPng {
  if (
    bytes.length < signature.length ||
    signature.some((value, index) => bytes[index] !== value)
  ) {
    return unsupported('Not a PNG file');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const compressed: Uint8Array[] = [];
  let header: { width: number; height: number; channels: number } | null = null;
  let offset = signature.length;
  let previous = '';
  let ended = false;

  while (!ended) {
    if (offset + 12 > bytes.length) {
      return unsupported('PNG chunk is truncated');
    }

    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const end = offset + 12 + length;

    if (length > 0x7fffffff || end > bytes.length) {
      return unsupported('PNG chunk is truncated');
    }

    const data = bytes.subarray(offset + 8, offset + 8 + length);

    if (
      crc32(bytes.subarray(offset + 4, offset + 8 + length)) !==
      view.getUint32(end - 4)
    ) {
      return unsupported(`PNG ${type} chunk fails its CRC check`);
    }

    if (header === null && type !== 'IHDR') {
      return unsupported('PNG does not start with IHDR');
    }

    if (type === 'IHDR') {
      if (header !== null || length !== 13) {
        return unsupported('PNG header is malformed');
      }

      const width = view.getUint32(offset + 8);
      const height = view.getUint32(offset + 12);
      const [bitDepth, colorType, compression, filter, interlace] =
        data.subarray(8);
      const channels = channelsByColorType[colorType ?? -1];

      if (
        bitDepth !== 8 ||
        channels === undefined ||
        compression !== 0 ||
        filter !== 0
      ) {
        return unsupported(
          `PNG format is unsupported (bit depth ${bitDepth}, color type ${colorType}); expected 8-bit RGB or RGBA`,
        );
      }

      if (interlace !== 0) {
        return unsupported('Interlaced PNG is unsupported');
      }

      if (
        width === 0 ||
        height === 0 ||
        width > maxPngSide ||
        height > maxPngSide ||
        width * height > maxPngPixels
      ) {
        return unsupported(
          `PNG dimensions ${width}×${height} are outside the supported ${maxPngSide}×${maxPngSide}, ${maxPngPixels}-pixel limit`,
        );
      }

      header = { width, height, channels };
    } else if (type === 'IDAT') {
      if (compressed.length > 0 && previous !== 'IDAT') {
        return unsupported('PNG image data chunks are not consecutive');
      }

      compressed.push(data);
    } else if (type === 'IEND') {
      ended = true;
    } else if ((type.charCodeAt(0) & 0x20) === 0) {
      return unsupported(`PNG critical chunk ${type} is unsupported`);
    }

    previous = type;
    offset = end;
  }

  if (offset !== bytes.length) {
    return unsupported('PNG has data after IEND');
  }

  if (header === null || compressed.length === 0) {
    return unsupported('PNG has no image data');
  }

  const { width, height, channels } = header;
  const expected = (width * channels + 1) * height;
  let inflated: Uint8Array;

  try {
    inflated = inflateSync(Buffer.concat(compressed), {
      maxOutputLength: expected,
    });
  } catch {
    return unsupported('PNG image data is corrupt or larger than its header');
  }

  if (inflated.length !== expected) {
    return unsupported('PNG image data does not match its header');
  }

  const rows = unfilter(inflated, width, height, channels);

  if (rows === null) {
    return unsupported('PNG row filter is invalid');
  }

  if (channels === 4) {
    return { kind: 'decoded', image: { width, height, rgba: rows } };
  }

  const rgba = new Uint8Array(width * height * 4);

  for (let source = 0, target = 0; source < rows.length; source += 3) {
    rgba[target++] = rows[source] ?? 0;
    rgba[target++] = rows[source + 1] ?? 0;
    rgba[target++] = rows[source + 2] ?? 0;
    rgba[target++] = 255;
  }

  return { kind: 'decoded', image: { width, height, rgba } };
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const output = new Uint8Array(data.length + 12);
  const view = new DataView(output.buffer);

  view.setUint32(0, data.length);
  output.set(new TextEncoder().encode(type), 4);
  output.set(data, 8);
  view.setUint32(data.length + 8, crc32(output.subarray(4, data.length + 8)));

  return output;
}

export function encodeRgbPng(
  width: number,
  height: number,
  rgb: Uint8Array,
): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);

  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8);

  const stride = width * 3;
  const rows = new Uint8Array((stride + 1) * height);

  for (let y = 0; y < height; y += 1) {
    rows.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  return Buffer.concat([
    new Uint8Array(signature),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', new Uint8Array()),
  ]);
}
