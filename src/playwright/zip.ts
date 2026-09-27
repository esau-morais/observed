import { crc32, inflateRawSync } from 'node:zlib';

export class ZipError extends Error {
  override readonly name = 'ZipError';
}

export type ZipEntry = {
  readonly name: string;
  readonly size: number;
  // Decompresses the entry and checks its CRC-32.
  readonly read: () => Uint8Array;
};

const endOfCentralDirectory = 0x06054b50;
const centralHeader = 0x02014b50;
const localHeader = 0x04034b50;

// Reads a zip from its central directory, the only reliable source of sizes
// when entries use data descriptors, as Playwright's trace and report zips
// do. Stored and deflated entries only; no Zip64, encryption, or spanning.
export function readZip(
  bytes: Uint8Array,
  maxEntrySize: number,
): ReadonlyMap<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEnd(view);
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryOffset = view.getUint32(end + 16, true);

  if (
    view.getUint16(end + 4, true) !== 0 ||
    count !== view.getUint16(end + 8, true) ||
    count === 0xffff ||
    directoryOffset === 0xffffffff
  ) {
    throw new ZipError('Multi-disk and Zip64 archives are not supported');
  }

  if (directoryOffset + directorySize > end) {
    throw new ZipError('Central directory lies outside the archive');
  }

  const entries = new Map<string, ZipEntry>();
  let offset = directoryOffset;

  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > end || view.getUint32(offset, true) !== centralHeader) {
      throw new ZipError('Malformed central directory');
    }

    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const checksum = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const headerOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
    );

    offset += 46 + nameLength + extraLength + commentLength;

    if ((flags & 0x1) !== 0) {
      throw new ZipError(`Entry ${name} is encrypted`);
    }

    if (method !== 0 && method !== 8) {
      throw new ZipError(`Entry ${name} uses unsupported method ${method}`);
    }

    if (entries.has(name)) {
      throw new ZipError(`Duplicate entry ${name}`);
    }

    entries.set(name, {
      name,
      size,
      read: () => {
        if (size > maxEntrySize) {
          throw new ZipError(
            `Entry ${name} is larger than ${maxEntrySize} bytes`,
          );
        }

        if (
          headerOffset + 30 > directoryOffset ||
          view.getUint32(headerOffset, true) !== localHeader
        ) {
          throw new ZipError(`Entry ${name} has no local header`);
        }

        const start =
          headerOffset +
          30 +
          view.getUint16(headerOffset + 26, true) +
          view.getUint16(headerOffset + 28, true);

        if (start + compressedSize > directoryOffset) {
          throw new ZipError(`Entry ${name} lies outside the archive`);
        }

        const data = bytes.subarray(start, start + compressedSize);
        let content = data;

        if (method === 8) {
          try {
            content = new Uint8Array(
              inflateRawSync(data, { maxOutputLength: Math.max(size, 1) }),
            );
          } catch {
            throw new ZipError(`Entry ${name} does not inflate to its size`);
          }
        }

        if (content.byteLength !== size || crc32(content) !== checksum) {
          throw new ZipError(`Entry ${name} fails its size or CRC-32 check`);
        }

        return content;
      },
    });
  }

  return entries;
}

function findEnd(view: DataView): number {
  // The end record is 22 bytes followed by a comment of at most 65535.
  const last = view.byteLength - 22;

  for (let offset = last; offset >= Math.max(0, last - 0xffff); offset -= 1) {
    if (
      view.getUint32(offset, true) === endOfCentralDirectory &&
      offset + 22 + view.getUint16(offset + 20, true) === view.byteLength
    ) {
      return offset;
    }
  }

  throw new ZipError('Not a zip archive');
}
