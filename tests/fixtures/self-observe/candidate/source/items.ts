import { Schema } from 'effect';

export const itemSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
});

export type Item = typeof itemSchema.Type;

export const itemsSchema = Schema.Array(itemSchema);

export async function requestItems(): Promise<readonly Item[]> {
  const response = await fetch('/api/items', {
    method: 'GET',
    cache: 'no-store',
    credentials: 'omit',
  });

  const body: unknown = await response.json();

  if (!response.ok) {
    throw new Error(`GET /api/items returned ${String(response.status)}`);
  }

  return Schema.decodeUnknownSync(itemsSchema)(body);
}
