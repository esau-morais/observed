import { BunServices } from '@effect/platform-bun';
import { Effect } from 'effect';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { exportComparison } from '../src/export';
import { serveReport } from '../src/view';
import { findSourceMap } from '../src/capture/source-maps';
import { json } from '../src/encoding';
import { comparisonSchema } from '../src/comparison-model';
import { Schema } from 'effect';

test.each(['base', 'candidate'] as const)(
  'exports and serves original %s source-failure artifacts without claiming source verification',
  async (side) => {
    const root = await mkdtemp(path.join(tmpdir(), 'observed-failed-export-'));
    try {
      await mkdir(path.join(root, 'dist/viewer'), { recursive: true });
      await writeFile(
        path.join(root, 'dist/viewer/index.html'),
        '<!doctype html><title>Failure export</title>',
      );
      const capture = path.join(root, side);
      await mkdir(capture);
      const files = {
        'source-failure.json': json({
          revision: 'missing-revision',
          reason: 'Needed a single revision',
        }),
        'source-transcript.jsonl':
          '{"command":"git","stderr":"Needed a single revision"}\n',
        'owner.json': '{"id":"disposable-failed-run"}\n',
      };
      for (const [filename, bytes] of Object.entries(files)) {
        await writeFile(path.join(capture, filename), bytes);
      }

      const exported = await Effect.runPromise(
        exportComparison({
          journeys: [
            {
              baseDirectory: side === 'base' ? capture : null,
              candidateDirectory:
                side === 'candidate'
                  ? capture
                  : path.join(root, 'missing-candidate'),
            },
          ],
          directory: path.join(root, 'report'),
          viewerDirectory: path.join(root, 'dist/viewer'),
        }).pipe(Effect.provide(BunServices.layer)),
      );
      expect(exported.result.journeys[0][side]).toMatchObject({
        capture: null,
        execution: 'unavailable',
        checks: [{ outcome: 'unknown' }],
      });
      expect(exported.result.journeys[0][side].unresolved.join(' ')).toContain(
        'missing-revision',
      );
      for (const [filename, bytes] of Object.entries(files)) {
        expect(
          await readFile(
            path.join(exported.directory, 'journey-1', side, filename),
            'utf8',
          ),
        ).toBe(bytes);
      }

      await Effect.runPromise(
        Effect.gen(function* () {
          const url = yield* serveReport({
            directory: exported.directory,
            port: 0,
          });
          yield* Effect.promise(async () => {
            for (const [filename, bytes] of Object.entries(files)) {
              const response = await fetch(
                new URL(`journey-1/${side}/${filename}`, url),
              );
              expect(response.status).toBe(200);
              expect(await response.text()).toBe(bytes);
            }

            const response = await fetch(new URL('result.json', url));
            const result = Schema.decodeUnknownSync(
              Schema.fromJsonString(comparisonSchema),
            )(await response.text());
            expect(result.journeys[0][side].checks[0]?.outcome).toBe('unknown');
            expect(result.journeys[0][side].artifacts).toHaveLength(3);
            expect(
              result.journeys[0][side].artifacts.every(
                (item) => item.integrity === 'verified',
              ),
            ).toBe(true);
          });
        }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
      );
      await writeFile(
        path.join(
          exported.directory,
          'journey-1',
          side,
          'source-transcript.jsonl',
        ),
        'changed',
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const url = yield* serveReport({
            directory: exported.directory,
            port: 0,
          });
          yield* Effect.promise(async () => {
            expect(
              (
                await fetch(
                  new URL(`journey-1/${side}/source-transcript.jsonl`, url),
                )
              ).status,
            ).toBe(404);
            const response = await fetch(new URL('result.json', url));
            const result = Schema.decodeUnknownSync(
              Schema.fromJsonString(comparisonSchema),
            )(await response.text());
            expect(result.journeys[0][side].checks[0]?.outcome).toBe('unknown');
            expect(
              result.journeys[0][side].artifacts.find(
                (item) => item.id === 'source-transcript',
              )?.integrity,
            ).toBe('unavailable');
          });
        }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

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
          journeys: [{ baseDirectory: null, candidateDirectory: candidate }],
          directory: path.join(root, 'report'),
          viewerDirectory: path.join(root, 'dist/viewer'),
        }).pipe(Effect.provide(BunServices.layer)),
      );

      const [journey] = exported.result.journeys;

      expect(journey.candidate.checks[0]?.outcome).toBe('unknown');

      expect(journey.comparison.kind).toBe('unavailable');

      expect(journey.candidate.unresolved.join(' ')).toMatch(
        /Candidate.*(unavailable|malformed)/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

// Self-observe builds the viewer with hidden source maps. Export once refused
// them, so setup failed before any capture ran.
test('a viewer build with a hidden source map exports, and coverage finds the map next to its script', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'observed-map-export-'));
  try {
    const viewer = path.join(root, 'dist/viewer');
    const map = json({
      version: 3,
      sources: ['../../../src/viewer/main.tsx'],
      mappings: 'AAAA',
    });
    await mkdir(path.join(viewer, 'assets'), { recursive: true });
    await writeFile(path.join(viewer, 'index.html'), '<!doctype html>');
    await writeFile(path.join(viewer, 'assets/index-a.js'), 'run();\n');
    await writeFile(path.join(viewer, 'assets/index-a.js.map'), map);

    const exported = await Effect.runPromise(
      exportComparison({
        journeys: [
          {
            baseDirectory: null,
            candidateDirectory: path.join(root, 'missing-candidate'),
          },
        ],
        directory: path.join(root, 'report'),
        viewerDirectory: viewer,
      }).pipe(Effect.provide(BunServices.layer)),
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const url = yield* serveReport({
          directory: exported.directory,
          port: 0,
        });
        const found = yield* findSourceMap(
          new URL('assets/index-a.js', url),
          new URL(url).origin,
        );

        expect(found).toEqual({ kind: 'found', text: map, via: 'adjacent' });
      }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
