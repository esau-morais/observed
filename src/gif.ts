// A GIF89a encoder for the scene export, written here because the package's
// runtime dependencies stay limited to agent-browser. One global palette of
// at most 256 colors from a median cut over every frame; each frame after the
// first stores only the rectangle that changed. Without a NETSCAPE looping
// extension the animation plays once and stops on its last frame.

export type GifFrame = {
  width: number;
  height: number;
  rgba: Uint8Array;
  // Milliseconds; GIF stores hundredths of a second.
  delay: number;
};

type Color = readonly [number, number, number];

type Bucket = { colors: Color[]; counts: number[] };

function key(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b;
}

// Distinct colors with their counts, sampled from every frame.
function histogram(frames: readonly GifFrame[]): Map<number, number> {
  const counts = new Map<number, number>();

  for (const frame of frames) {
    const pixels = frame.width * frame.height;
    const stride = Math.max(1, Math.floor((pixels * frames.length) / 400_000));

    for (let pixel = 0; pixel < pixels; pixel += stride) {
      const at = pixel * 4;
      const color = key(
        frame.rgba[at] ?? 0,
        frame.rgba[at + 1] ?? 0,
        frame.rgba[at + 2] ?? 0,
      );

      counts.set(color, (counts.get(color) ?? 0) + 1);
    }
  }

  return counts;
}

function channelRange(bucket: Bucket, channel: 0 | 1 | 2): number {
  let low = 255;
  let high = 0;

  for (const color of bucket.colors) {
    low = Math.min(low, color[channel]);
    high = Math.max(high, color[channel]);
  }

  return high - low;
}

function widest(bucket: Bucket): 0 | 1 | 2 {
  const red = channelRange(bucket, 0);
  const green = channelRange(bucket, 1);
  const blue = channelRange(bucket, 2);

  if (red >= green && red >= blue) {
    return 0;
  }

  return green >= blue ? 1 : 2;
}

function split(bucket: Bucket): [Bucket, Bucket] {
  const channel = widest(bucket);
  const order = bucket.colors
    .map((color, index) => ({ color, count: bucket.counts[index] ?? 0 }))
    .sort((a, b) => a.color[channel] - b.color[channel]);
  const total = order.reduce((sum, item) => sum + item.count, 0);
  let seen = 0;
  let cut = 1;

  for (const [index, item] of order.entries()) {
    seen += item.count;

    if (seen >= total / 2) {
      cut = Math.min(Math.max(index + 1, 1), order.length - 1);
      break;
    }
  }

  const take = (items: typeof order): Bucket => ({
    colors: items.map((item) => item.color),
    counts: items.map((item) => item.count),
  });

  return [take(order.slice(0, cut)), take(order.slice(cut))];
}

function average(bucket: Bucket): Color {
  let total = 0;
  const sum = [0, 0, 0];

  for (const [index, color] of bucket.colors.entries()) {
    const count = bucket.counts[index] ?? 0;

    total += count;
    sum[0] = (sum[0] ?? 0) + color[0] * count;
    sum[1] = (sum[1] ?? 0) + color[1] * count;
    sum[2] = (sum[2] ?? 0) + color[2] * count;
  }

  const [r = 0, g = 0, b = 0] = sum.map((value) =>
    Math.round(value / Math.max(total, 1)),
  );

  return [r, g, b];
}

export function palette(frames: readonly GifFrame[]): Color[] {
  const counts = histogram(frames);
  const colors = [...counts.keys()].map((color): Color => [
    (color >> 16) & 255,
    (color >> 8) & 255,
    color & 255,
  ]);

  if (colors.length <= 256) {
    return colors;
  }

  let buckets: Bucket[] = [{ colors, counts: [...counts.values()] }];

  // Split the bucket with the widest channel until the palette is full.
  while (buckets.length < 256) {
    let index = -1;
    let range = 0;

    for (const [at, bucket] of buckets.entries()) {
      const widestRange = channelRange(bucket, widest(bucket));

      if (bucket.colors.length > 1 && widestRange >= range) {
        index = at;
        range = widestRange;
      }
    }

    const chosen = buckets[index];

    if (chosen === undefined) {
      break;
    }

    buckets = [
      ...buckets.slice(0, index),
      ...split(chosen),
      ...buckets.slice(index + 1),
    ];
  }

  return buckets.map(average);
}

function nearest(table: readonly Color[], r: number, g: number, b: number) {
  let best = 0;
  let distance = Infinity;

  for (const [index, color] of table.entries()) {
    const dr = color[0] - r;
    const dg = color[1] - g;
    const db = color[2] - b;
    const next = 2 * dr * dr + 4 * dg * dg + 3 * db * db;

    if (next < distance) {
      distance = next;
      best = index;

      if (next === 0) {
        break;
      }
    }
  }

  return best;
}

function indexed(frame: GifFrame, table: readonly Color[]): Uint8Array {
  const cache = new Map<number, number>();
  const pixels = frame.width * frame.height;
  const out = new Uint8Array(pixels);

  for (let pixel = 0; pixel < pixels; pixel++) {
    const at = pixel * 4;
    const r = frame.rgba[at] ?? 0;
    const g = frame.rgba[at + 1] ?? 0;
    const b = frame.rgba[at + 2] ?? 0;
    const color = key(r, g, b);
    let index = cache.get(color);

    if (index === undefined) {
      index = nearest(table, r, g, b);
      cache.set(color, index);
    }

    out[pixel] = index;
  }

  return out;
}

class Bytes {
  private chunks: number[] = [];

  byte(value: number) {
    this.chunks.push(value & 255);
  }

  word(value: number) {
    this.byte(value);
    this.byte(value >> 8);
  }

  text(value: string) {
    for (const character of value) {
      this.byte(character.charCodeAt(0));
    }
  }

  bytes(values: Iterable<number>) {
    for (const value of values) {
      this.byte(value);
    }
  }

  done(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

// Variable-length LZW as GIF specifies it: codes grow to 12 bits, and a clear
// code restarts the table when it fills.
export function lzw(indices: Uint8Array, minimum: number): Uint8Array {
  const clear = 1 << minimum;
  const end = clear + 1;
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  let size = minimum + 1;
  let next = end + 1;
  let table = new Map<number, number>();
  const emit = (code: number) => {
    buffer |= code << bits;
    bits += size;

    while (bits >= 8) {
      out.push(buffer & 255);
      buffer >>>= 8;
      bits -= 8;
    }
  };

  emit(clear);

  let prefix = indices[0] ?? 0;

  for (let at = 1; at < indices.length; at++) {
    const value = indices[at] ?? 0;
    const pair = (prefix << 8) | value;
    const known = table.get(pair);

    if (known !== undefined) {
      prefix = known;
      continue;
    }

    emit(prefix);

    if (next < 4096) {
      table.set(pair, next);
      next++;

      if (next > 1 << size && size < 12) {
        size++;
      }
    } else {
      emit(clear);
      table = new Map();
      size = minimum + 1;
      next = end + 1;
    }

    prefix = value;
  }

  emit(prefix);
  emit(end);

  if (bits > 0) {
    out.push(buffer & 255);
  }

  return Uint8Array.from(out);
}

type Rect = { x: number; y: number; width: number; height: number };

function changed(
  previous: Uint8Array,
  current: Uint8Array,
  width: number,
  height: number,
): Rect | null {
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * width + x;

      if (previous[at] !== current[at]) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }

  return right === -1
    ? null
    : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

function crop(indices: Uint8Array, width: number, rect: Rect): Uint8Array {
  const out = new Uint8Array(rect.width * rect.height);

  for (let row = 0; row < rect.height; row++) {
    const from = (rect.y + row) * width + rect.x;

    out.set(indices.subarray(from, from + rect.width), row * rect.width);
  }

  return out;
}

export function encodeGif(frames: readonly GifFrame[]): Uint8Array {
  const [first] = frames;

  if (first === undefined) {
    throw new Error('A GIF needs at least one frame');
  }

  if (
    frames.some(
      (frame) => frame.width !== first.width || frame.height !== first.height,
    )
  ) {
    throw new Error('Every GIF frame must have the same size');
  }

  const { width, height } = first;
  const colors = palette(frames);
  const depth = Math.max(1, Math.ceil(Math.log2(Math.max(colors.length, 2))));
  const out = new Bytes();

  out.text('GIF89a');
  out.word(width);
  out.word(height);
  out.byte(0x80 | ((depth - 1) << 4) | (depth - 1));
  out.byte(0);
  out.byte(0);

  for (let index = 0; index < 1 << depth; index++) {
    out.bytes(colors[index] ?? [0, 0, 0]);
  }

  const write = (frame: { indices: Uint8Array; rect: Rect; delay: number }) => {
    out.bytes([0x21, 0xf9, 4, 0x04]);
    // Hundredths of a second in 16 bits.
    out.word(Math.min(65_535, Math.max(2, Math.round(frame.delay / 10))));
    out.bytes([0, 0]);
    out.byte(0x2c);
    out.word(frame.rect.x);
    out.word(frame.rect.y);
    out.word(frame.rect.width);
    out.word(frame.rect.height);
    out.byte(0);

    const minimum = Math.max(2, depth);
    const data = lzw(crop(frame.indices, width, frame.rect), minimum);

    out.byte(minimum);

    for (let at = 0; at < data.length; at += 255) {
      const block = data.subarray(at, at + 255);

      out.byte(block.length);
      out.bytes(block);
    }

    out.byte(0);
  };

  let pending = {
    indices: indexed(first, colors),
    rect: { x: 0, y: 0, width, height },
    delay: first.delay,
  };

  for (const frame of frames.slice(1)) {
    const indices = indexed(frame, colors);
    const rect = changed(pending.indices, indices, width, height);

    if (rect === null) {
      // An unchanged frame lengthens the one before it.
      pending.delay += frame.delay;
      continue;
    }

    write(pending);
    pending = { indices, rect, delay: frame.delay };
  }

  write(pending);

  out.byte(0x3b);

  return out.done();
}
