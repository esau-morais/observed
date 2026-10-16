import { BunServices } from '@effect/platform-bun';
import { receipt, selectionSchemaVersion, type Selection } from '@observed/judge';
import {
  evaluatedAt,
  judgedSides,
  projectJourney,
  removeTemporaryDirectories,
  requestCheck,
  selectedComparison,
  temporaryDirectory,
} from '@observed/judge/testing';
import { writeRecord } from '@observed/runner';
import { Effect } from 'effect';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';

afterEach(removeTemporaryDirectories);

const main = fileURLToPath(new URL('./main.ts', import.meta.url));

it('prints its version and exits cleanly', () => {
  const result = spawnSync('bun', [main, '--version'], { encoding: 'utf8' });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('0.0.0');
});

it('prints the stored receipt for a commit, and fails without the evidence ref', async () => {
  const repo = await temporaryDirectory('observed-cli-repo-');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@localhost',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'app',
    ],
    { cwd: repo },
  );
  const printed = () =>
    spawnSync('bun', [main, 'receipt', 'HEAD'], { cwd: repo, encoding: 'utf8' });

  const missing = printed();
  expect(missing.status).toBe(1);
  expect(missing.stdout).toBe('');
  expect(missing.stderr).toContain('refs/observed/evidence is missing');

  const bundles = await judgedSides({ captured: [requestCheck], baseCount: 1, candidateCount: 2 });
  const recipes: Selection['recipes'] = {
    base: { kind: 'unavailable', reason: 'Not read in this test.' },
    candidate: [projectJourney([requestCheck])],
  };
  const selection: Selection = {
    schemaVersion: selectionSchemaVersion,
    evaluatedAt,
    mode: 'comparison',
    journeys: [{ directory: 'journey-1', base: null, candidate: null }],
    recipes,
  };
  const result = await selectedComparison(bundles, recipes);
  await Effect.runPromise(
    writeRecord({
      cwd: repo,
      commit: 'HEAD',
      captures: bundles.candidate.directory,
      selection,
      result,
    }).pipe(Effect.provide(BunServices.layer)),
  );

  const stored = printed();
  expect(stored.status).toBe(0);
  expect(stored.stdout).toBe(`${receipt(result)}\n`);
});
