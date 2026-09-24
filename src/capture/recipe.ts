import { createHash } from 'node:crypto';

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export const recipe = {
  id: 'items-once-v1',
  application: 'Observed request lab',
  action: { role: 'button', name: 'Load items' },
  readyText: 'Load items',
  completionText: 'Items loaded',
  check: {
    id: 'one-items-request',
    name: 'One request per load action',
    method: 'GET',
    path: '/api/items',
    expectedCount: 1,
    scope:
      'One Load items click, from an empty isolated browser session, through completion and network idle. Later activity is outside scope.',
  },
  viewport: { width: 1120, height: 800, scale: 1 },
  browserArguments: [
    '--no-sandbox',
    '--disable-gpu',
    '--force-color-profile=srgb',
  ],
  fixture: {
    items: [
      { id: 'notebook', name: 'Notebook' },
      { id: 'pencil', name: 'Pencil' },
      { id: 'ruler', name: 'Ruler' },
    ],
  },
  maxAgeMs: 86_400_000,
} as const;

export const recipeText = json(recipe);

export const recipeHash = sha256(recipeText);

export const fixtureHash = sha256(json(recipe.fixture));

export const producer = { name: 'agent-browser', version: '0.38.1' } as const;
