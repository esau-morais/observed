import type { Recipe } from '../../src/capture/recipe';
import { json, sha256 } from '../../src/encoding';

export const recipe = {
  schemaVersion: 1,
  id: 'items-once-v1',
  name: 'Load items',
  path: '/',
  ready: [{ kind: 'wait-text', text: 'Load items' }],
  steps: [
    { kind: 'click-role', role: 'button', name: 'Load items' },
    { kind: 'wait-text', text: 'Items loaded' },
    { kind: 'network-idle' },
  ],
  check: {
    kind: 'request-count',
    id: 'one-items-request',
    name: 'One request per load action',
    method: 'GET',
    path: '/api/items',
    expectedCount: 1,
    status: 200,
    scope: 'One Load items click through completion and network idle.',
  },
  viewport: { width: 1120, height: 800, scale: 1 },
  browserArguments: ['--no-sandbox'],
  maxAgeMs: 86_400_000,
} as const satisfies Recipe;

export const recipeText = json(recipe);
export const recipeHash = sha256(recipeText);
export const producer = { name: 'synthetic-tests', version: '1' };
export const fixtureHash = sha256('synthetic test inputs');
