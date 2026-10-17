import { journeyRecipe, recipeSchema } from '@observed/judge';
import { Effect, Schema } from 'effect';
import { afterEach, expect, test, vi } from 'vitest';
import { collectorNames, environmentValues } from './capture';

afterEach(() => {
  vi.unstubAllEnvs();
});

const recipe = Schema.decodeUnknownSync(recipeSchema)(
  journeyRecipe({
    name: 'Readings',
    path: '/',
    ready: [],
    steps: [],
    collectors: [
      {
        kind: 'api',
        operations: [
          {
            id: 'create',
            method: 'POST',
            path: '/api/readings',
            headers: [{ name: 'Authorization', env: 'API_TOKEN', prefix: 'Bearer ' }],
          },
        ],
      },
      { kind: 'playwright', command: ['bun', 'run', 'test:e2e'], environment: ['E2E_PASSWORD'] },
    ],
  }),
);

test('fails the capture when a collector variable is missing or empty', async () => {
  vi.stubEnv('API_TOKEN', '');
  vi.stubEnv('E2E_PASSWORD', undefined);

  const failure = await Effect.runPromise(
    Effect.flip(environmentValues(collectorNames(recipe), 'Collector environment value')),
  );

  expect(failure).toMatchObject({
    category: 'configuration',
    message:
      'Collector environment value unavailable. Missing or empty environment variables: API_TOKEN, E2E_PASSWORD',
  });
});
