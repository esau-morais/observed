import { BunServices } from '@effect/platform-bun';
import { Effect, Schema } from 'effect';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { recordSourceMaps } from '../src/capture/source-maps';
import { json } from '../src/encoding';
import { sourceMapIndexSchema } from '../src/source-map';

const map = (source: string) =>
  json({ version: 3, sources: [source], names: [], mappings: 'AAAA' });

const routes: Record<string, string> = {
  '/assets/hidden.js': 'hidden();\n',
  '/assets/hidden.js.map': map('../../src/hidden.js'),
  '/assets/linked.js': 'linked();\n//# sourceMappingURL=../maps/linked.map\n',
  '/maps/linked.map': map('../src/linked.js'),
  '/assets/external.js':
    'external();\n//# sourceMappingURL=https://example.com/external.map\n',
  '/assets/plain.js': 'plain();\n',
};

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((item) => rm(item, { recursive: true })),
  );
});

test('fetches hidden and linked source maps from the application origin only', async () => {
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: (request) => {
      const body = routes[new URL(request.url).pathname];

      return new Response(body ?? 'not found', {
        status: body === undefined ? 404 : 200,
      });
    },
  });
  const directory = await mkdtemp(path.join(tmpdir(), 'observed-maps-test-'));
  directories.push(directory);
  const origin = `http://127.0.0.1:${server.port}`;
  const frames = ['hidden', 'linked', 'external', 'plain']
    .map((name) => `    at ${name} (${origin}/assets/${name}.js:1:1)`)
    .concat('    at other (https://cdn.example.com/lib.js:1:1)')
    .join('\n');

  await mkdir(path.join(directory, 'evidence'));
  await writeFile(
    path.join(directory, 'evidence', 'browser-errors.json'),
    json({
      kind: 'browser-errors',
      schemaVersion: 1,
      value: {
        steps: 1,
        coverage: { kind: 'complete' },
        entries: [
          {
            source: 'page',
            text: `TypeError: boom\n${frames}`,
            step: 0,
            after: '2026-09-27T12:00:00.000Z',
            seenAt: '2026-09-27T12:00:01.000Z',
          },
        ],
      },
    }),
  );

  const artifacts: string[] = [];

  try {
    await Effect.runPromise(
      recordSourceMaps({
        directory,
        url: `${origin}/`,
        concealed: [],
        addArtifact: (id, filename) => artifacts.push(`${id} ${filename}`),
      }).pipe(Effect.provide(BunServices.layer)),
    );
  } finally {
    await server.stop(true);
  }

  const index = Schema.decodeUnknownSync(
    Schema.fromJsonString(sourceMapIndexSchema),
  )(await readFile(path.join(directory, 'source-maps.json'), 'utf8'));

  expect(index).toMatchObject({
    origin,
    scripts: [
      {
        script: '/assets/hidden.js',
        map: { kind: 'recorded', via: 'adjacent' },
      },
      {
        script: '/assets/linked.js',
        map: { kind: 'recorded', via: 'sourceMappingURL' },
      },
      {
        script: '/assets/external.js',
        map: {
          kind: 'unavailable',
          reason:
            "No source map: /assets/external.js.map: HTTP 404, and its sourceMappingURL is outside the application's origin",
        },
      },
      {
        script: '/assets/plain.js',
        map: {
          kind: 'unavailable',
          reason:
            'No source map: /assets/plain.js.map: HTTP 404, and the script names no sourceMappingURL',
        },
      },
    ],
  });
  expect(index.scripts).toHaveLength(4);
  expect(artifacts).toEqual([
    'source-map-1 source-maps/1-hidden.js.map',
    'source-map-2 source-maps/2-linked.js.map',
    'source-maps source-maps.json',
  ]);
  expect(
    JSON.parse(
      await readFile(
        path.join(directory, 'source-maps', '2-linked.js.map'),
        'utf8',
      ),
    ),
  ).toEqual(JSON.parse(routes['/maps/linked.map'] ?? ''));
});
