import { BunServices } from '@effect/platform-bun';
import { Effect, Schema } from 'effect';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'vitest';
import { captureBrowser } from '../../src/capture/agent-browser';
import { observationsSchema } from '../../src/capture/model';
import { parseGeneratedJourneys } from '../../src/generated-journeys';

test('generated server checks include navigation and readiness while saved windows stay post-ready', async () => {
  const root = path.resolve(import.meta.dirname, '../..');
  await mkdir(path.join(root, 'evidence'), { recursive: true });
  const directory = await mkdtemp(
    path.join(root, 'evidence/generated-window-'),
  );
  await writeFile(
    path.join(directory, 'EXPECTATIONS.md'),
    'Generated requests include initial 500, readiness 502, action 503. Saved requests include only action 503. Both captures validate HAR/log agreement and close their browser.\n',
  );
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const route = new URL(request.url).pathname;
      if (route === '/favicon.ico') {
        return new Response(null, { status: 204 });
      }

      const earlyStatus = route === '/' ? 500 : 502;

      return new Response(
        `<!doctype html><html lang="en"><title>Errors</title><main><h1>Errors</h1><button onclick="fetch('/action').then(() => this.textContent = 'Done')">Run</button></main></html>`,
        {
          status: route === '/action' ? 503 : earlyStatus,
          headers: { 'content-type': 'text/html' },
        },
      );
    },
  });
  try {
    const {
      recipes: [recipe],
    } = await Effect.runPromise(
      parseGeneratedJourneys(
        JSON.stringify({
          schemaVersion: 1,
          journeys: [
            {
              name: 'Early errors',
              path: '/',
              ready: [{ kind: 'navigate', path: '/ready' }],
              steps: [
                { kind: 'click', selector: 'button' },
                { kind: 'wait-text', text: 'Done' },
              ],
              targets: ['server.ts'],
              reason: 'Exercise initial requests.',
            },
          ],
        }),
        [
          {
            name: 'Environment',
            path: '/',
            ready: [],
            steps: [],
            browserArguments: ['--no-sandbox'],
          },
        ],
      ),
    );
    if (recipe === undefined) {
      throw new Error('Expected one generated recipe');
    }

    const saved = { ...recipe };
    delete saved.generated;
    for (const [name, current] of [
      ['generated', recipe],
      ['saved', saved],
    ] as const) {
      const capture = path.join(directory, name);
      await mkdir(capture);
      await Effect.runPromise(
        captureBrowser({
          projectRoot: root,
          directory: capture,
          session: `f-${path.basename(directory)}-${name}`,
          url: server.url.toString(),
          recipe: current,
          addArtifact: () => {},
          addEvidence: () => {},
          fillValues: new Map(),
          collectorValues: new Map(),
          inputsHash: '0'.repeat(64),
          dependenciesHash: null,
          workspace: root,
          sourceFiles: new Set(),
          timeoutMs: 60_000,
        }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
      );
      const observations = Schema.decodeUnknownSync(
        Schema.fromJsonString(observationsSchema),
      )(await readFile(path.join(capture, 'observations.json'), 'utf8'));
      expect(
        observations.requests
          .filter((request) => request.status >= 500)
          .map((request) => [request.path, request.status]),
      ).toEqual(
        name === 'generated'
          ? [
              ['/', 500],
              ['/ready', 502],
              ['/action', 503],
            ]
          : [['/action', 503]],
      );
      const cleanup = Schema.decodeUnknownSync(
        Schema.fromJsonString(Schema.Struct({ active: Schema.Boolean })),
      )(await readFile(path.join(capture, 'browser-cleanup.json'), 'utf8'));
      expect(cleanup.active).toBe(false);
    }
  } finally {
    await server.stop(true);
  }
});
