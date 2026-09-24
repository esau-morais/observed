import { BunServices } from '@effect/platform-bun';
import { Effect, Schema } from 'effect';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import shop from '../examples/shop/observed.json';
import { loadProject } from '../src/project';
import { checkSchema } from '../src/capture/recipe';
import { json } from '../src/encoding';

test.each(['/orders?category=books', '/orders#submitted'])(
  'rejects unsupported request matching syntax %s',
  (route) => {
    expect(() =>
      Schema.decodeUnknownSync(checkSchema)({
        kind: 'request-count',
        id: 'orders',
        name: 'No orders',
        scope: 'One submission',
        method: 'POST',
        path: route,
        expectedCount: 0,
        status: 201,
      }),
    ).toThrow();
  },
);

test('rejects credential-bearing configuration before creating public capture artifacts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'observed-project-'));

  try {
    await writeFile(
      path.join(root, 'observed.json'),
      json({
        ...shop,
        capture: { ...shop.capture, path: '/?token=sensitive-value' },
      }),
    );
    const result = await Effect.runPromise(
      loadProject(root).pipe(Effect.provide(BunServices.layer), Effect.flip),
    );

    expect(result.message).toContain('credentials');
    expect(result.message).not.toContain('sensitive-value');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
