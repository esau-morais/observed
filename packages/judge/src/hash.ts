import { createHash } from 'node:crypto';

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
