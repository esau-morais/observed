import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const main = fileURLToPath(new URL('./main.ts', import.meta.url));

it('prints its version and exits cleanly', () => {
  const result = spawnSync('bun', [main, '--version'], { encoding: 'utf8' });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('0.0.0');
});
