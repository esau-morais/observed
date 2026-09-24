import { BunServices } from '@effect/platform-bun';
import { Effect } from 'effect';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { exportComparison } from '../src/export';

test.each(['missing', 'malformed'])(
  '%s candidate manifests produce unavailable reports rather than aborting export',
  async (fault) => {
    const root = await mkdtemp(path.join(tmpdir(), 'observed-export-'));

    try {
      await mkdir(path.join(root, 'dist/viewer'), { recursive: true });

      await writeFile(
        path.join(root, 'dist/viewer/index.html'),
        '<!doctype html><title>Test viewer asset</title>',
      );

      const candidate = path.join(root, 'candidate');

      if (fault === 'malformed') {
        await mkdir(candidate);

        await writeFile(path.join(candidate, 'capture.json'), '{}');
      }

      const exported = await Effect.runPromise(
        exportComparison({
          baseDirectory: null,
          candidateDirectory: candidate,
          directory: path.join(root, 'report'),
          projectRoot: root,
        }).pipe(Effect.provide(BunServices.layer)),
      );

      expect(exported.result.candidate.check.outcome).toBe('unknown');

      expect(exported.result.comparison.kind).toBe('unavailable');

      expect(exported.result.candidate.unresolved.join(' ')).toMatch(
        /Candidate.*(unavailable|malformed)/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
