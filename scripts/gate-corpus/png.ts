import { inflateSync } from 'node:zlib';

export type Pixels = {
  width: number;
  height: number;
  channels: number;
  rows: Uint8Array[];
};

const signature = '89504e470d0a1a0a';

function paeth(left: number, up: number, corner: number) {
  const estimate = left + up - corner;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toCorner = Math.abs(estimate - corner);
  if (toLeft <= toUp && toLeft <= toCorner) {
    return left;
  }

  return toUp <= toCorner ? up : corner;
}

// Decodes only the non-interlaced 8-bit RGB and RGBA PNGs the capture writes,
// following https://www.w3.org/TR/png-3/ (IHDR, IDAT, filter types 0 to 4).
// It stays separate from the comparator's decoder so the corpus can check it.
export function decodePng(bytes: Uint8Array): Pixels {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.length < 33 || view.subarray(0, 8).toString('hex') !== signature) {
    throw new Error('Not a PNG');
  }

  let header: Buffer | undefined;
  const data: Buffer[] = [];
  let offset = 8;
  let ended = false;
  while (offset + 12 <= view.length) {
    const length = view.readUInt32BE(offset);
    const type = view.toString('latin1', offset + 4, offset + 8);
    const end = offset + 8 + length;
    if (end + 4 > view.length) {
      throw new Error(`Truncated PNG ${type} chunk`);
    }

    const body = view.subarray(offset + 8, end);
    if (type === 'IHDR') {
      header = body;
    } else if (type === 'IDAT') {
      data.push(body);
    } else if (type === 'IEND') {
      ended = true;
      break;
    }

    offset = end + 4;
  }

  if (header === undefined || header.length !== 13 || !ended) {
    throw new Error('Incomplete PNG');
  }

  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const channels = { 2: 3, 6: 4 }[header[9] ?? -1];
  if (
    width === 0 ||
    height === 0 ||
    header[8] !== 8 ||
    channels === undefined ||
    header[10] !== 0 ||
    header[11] !== 0 ||
    header[12] !== 0
  ) {
    throw new Error('Unsupported PNG format');
  }

  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  if (raw.length !== height * (stride + 1)) {
    throw new Error('PNG image data does not match its header');
  }

  const rows: Uint8Array[] = [];
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const start = y * (stride + 1);
    const filter = raw[start];
    const row = Uint8Array.from(raw.subarray(start + 1, start + 1 + stride));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? (row[x - channels] ?? 0) : 0;
      const up = previous[x] ?? 0;
      const corner = x >= channels ? (previous[x - channels] ?? 0) : 0;
      const value = row[x] ?? 0;
      if (filter === 1) {
        row[x] = value + left;
      } else if (filter === 2) {
        row[x] = value + up;
      } else if (filter === 3) {
        row[x] = value + ((left + up) >> 1);
      } else if (filter === 4) {
        row[x] = value + paeth(left, up, corner);
      } else if (filter !== 0) {
        throw new Error(`Unknown PNG filter ${filter}`);
      }
    }

    rows.push(row);
    previous = row;
  }

  return { width, height, channels, rows };
}
