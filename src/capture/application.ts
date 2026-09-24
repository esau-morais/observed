import { DateTime, Effect, FileSystem, Schema } from 'effect';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { nodeIo } from '../node-io';
import { json, recipe } from './recipe';

export class ApplicationFailure extends Schema.TaggedError<ApplicationFailure>()(
  'ApplicationFailure',
  { message: Schema.String },
) {}

export const listFiles = Effect.fn('listFiles')(function* (directory: string) {
  const visit = Effect.fnUntraced(function* (
    relative: string,
  ): Effect.fn.Return<string[], import('../node-io').EvidenceIoError> {
    const entries = yield* nodeIo(() =>
      readdir(path.join(directory, relative), { withFileTypes: true }),
    );

    const files: string[] = [];

    for (const entry of entries) {
      const name = path.posix.join(relative, entry.name);

      if (entry.isDirectory()) {
        files.push(...(yield* visit(name)));
      } else if (entry.isFile()) {
        files.push(name);
      } else {
        return yield* Effect.die(
          new Error(`Unsupported source entry: ${name}`),
        );
      }
    }

    return files.sort();
  });

  return yield* visit('');
});

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

export const startApplication = Effect.fn('startApplication')(
  function* (options: {
    directory: string;
    evidenceDirectory: string;
    stall?: boolean;
  }) {
    const fs = yield* FileSystem.FileSystem;

    const files = yield* listFiles(options.directory);

    const assets = new Map<
      string,
      { bytes: Uint8Array<ArrayBuffer>; type: string }
    >();

    for (const file of files) {
      const bytes = yield* fs.readFile(path.join(options.directory, file));

      assets.set(`/${file}`, {
        bytes: new Uint8Array(bytes),
        type: contentTypes[path.extname(file)] ?? 'application/octet-stream',
      });
    }

    const requests: { method: string; path: string; receivedAt: string }[] = [];

    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: '127.0.0.1',
          port: 0,
          fetch(request) {
            const pathname = new URL(request.url).pathname;

            if (pathname === '/health') {
              return new Response('ready');
            }

            if (pathname === '/api/items') {
              requests.push({
                method: request.method,
                path: pathname,
                receivedAt: DateTime.formatIso(DateTime.nowUnsafe()),
              });

              if (options.stall === true) {
                return new Promise<Response>(() => {});
              }

              return Response.json(recipe.fixture.items, {
                headers: { 'Cache-Control': 'no-store' },
              });
            }

            const asset = assets.get(
              pathname === '/' ? '/index.html' : pathname,
            );

            if (asset === undefined) {
              return new Response('Not found', { status: 404 });
            }

            return new Response(asset.bytes, {
              headers: {
                'Content-Type': asset.type,
                'Cache-Control': 'no-store',
              },
            });
          },
        }),
      ),
      (owned) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => owned.stop(true));

          yield* fs.writeFileString(
            path.join(options.evidenceDirectory, 'server-requests.json'),
            json(requests),
            { flag: 'wx' },
          );

          yield* fs.writeFileString(
            path.join(options.evidenceDirectory, 'server-cleanup.json'),
            json({
              url: owned.url.toString(),
              stopped: true,
            }),
            { flag: 'wx' },
          );
        }).pipe(Effect.orDie),
    );

    const ready = yield* Effect.tryPromise({
      try: (signal) => fetch(new URL('/health', server.url), { signal }),
      catch: () =>
        new ApplicationFailure({
          message: 'Application readiness request failed',
        }),
    }).pipe(Effect.timeout('5 seconds'));

    if (!ready.ok || (yield* Effect.promise(() => ready.text())) !== 'ready') {
      return yield* new ApplicationFailure({
        message: 'Application did not become ready',
      });
    }

    return server.url.toString();
  },
);
