import { Effect, Exit, Fiber, Schema } from 'effect';
import { afterEach, expect, test } from 'vitest';
import { connectCdp } from '../src/capture/cdp';
import {
  coverageFiles,
  lineRuns,
  type CoveredFunction,
} from '../src/capture/collectors/coverage';
import { evidenceKinds } from '../src/evidence-kinds';

const digits =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function vlq(value: number): string {
  let rest = value < 0 ? (-value << 1) | 1 : value << 1;
  let encoded = '';

  do {
    const digit = rest & 31;

    rest >>>= 5;
    encoded += digits[rest > 0 ? digit | 32 : digit];
  } while (rest > 0);

  return encoded;
}

// One generated line; each segment is [generated column, original line],
// both 0-based, in source 0 at original column 0.
function mappings(segments: readonly [number, number][]): string {
  let column = 0;
  let line = 0;

  return segments
    .map(([generated, original]) => {
      const encoded = `${vlq(generated - column)}A${vlq(original - line)}A`;

      column = generated;
      line = original;

      return encoded;
    })
    .join(',');
}

// app.ts, before minification:
//  1 function unused() {
//  2   return 3;
//  3 }
//  4 function used(flag) {
//  5   if (flag) {
//  6     return 1;
//  7   }
//  8   return 2;
//  9 }
// 10 used(false);
const generated =
  'function c(){return 3}function a(b){if(b){return 1}return 2}a(!1);';
const at = (text: string) => generated.indexOf(text);
const map = {
  version: 3 as const,
  sources: ['../src/app.ts'],
  mappings: mappings([
    [at('function c'), 0],
    [at('return 3'), 1],
    [at('function a'), 3],
    [at('if(b)'), 4],
    [at('return 1'), 5],
    [at('return 2'), 7],
    [at('a(!1)'), 9],
  ]),
};
// What V8 reports for that run: the script ran, `c` was never called and
// starts where the script does, and `a` ran once with its `if` block skipped.
const functions: CoveredFunction[] = [
  {
    functionName: '',
    ranges: [{ startOffset: 0, endOffset: generated.length, count: 1 }],
  },
  {
    functionName: 'c',
    ranges: [{ startOffset: 0, endOffset: at('function a'), count: 0 }],
  },
  {
    functionName: 'a',
    ranges: [
      { startOffset: at('function a'), endOffset: at('a(!1)'), count: 1 },
      { startOffset: at('{return 1}'), endOffset: at('return 2'), count: 0 },
    ],
  },
];

test('maps block counts through a minified bundle to original lines', () => {
  const runs = lineRuns({
    source: generated,
    map,
    copies: [functions],
    paths: new Map([[0, 'src/app.ts']]),
  });

  expect(runs === null ? null : coverageFiles([runs])).toEqual([
    {
      path: 'src/app.ts',
      executed: [
        [4, 5],
        [8, 8],
        [10, 10],
      ],
      unexecuted: [
        [1, 2],
        [6, 6],
      ],
    },
  ]);
});

test('counts a line as executed when any script ran it', () => {
  const ran = new Map([['src/app.ts', new Map([[3, true]])]]);
  const idle = new Map([
    [
      'src/app.ts',
      new Map([
        [3, false],
        [4, false],
      ]),
    ],
  ]);

  expect(coverageFiles([idle, ran])).toEqual([
    { path: 'src/app.ts', executed: [[3, 3]], unexecuted: [[4, 4]] },
  ]);
});

test('rejects coverage evidence that lists a line as both executed and unexecuted', () => {
  const decode = Schema.decodeUnknownExit(evidenceKinds.coverage.file);
  const file = (unexecuted: readonly [number, number][]) => ({
    kind: 'coverage',
    schemaVersion: 1,
    value: {
      files: [{ path: 'src/app.ts', executed: [[1, 4]], unexecuted }],
      scripts: [],
    },
  });

  expect(Exit.isSuccess(decode(file([[5, 6]])))).toBe(true);
  expect(Exit.isSuccess(decode(file([[4, 6]])))).toBe(false);
});

const servers: Bun.Server<undefined>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop(true)));
});

// A DevTools stand-in that answers Echo, rejects Fail, never answers Hang,
// and counts open connections.
function devtools() {
  let open = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request, current) =>
      current.upgrade(request)
        ? undefined
        : new Response('upgrade required', { status: 426 }),
    websocket: {
      open: () => {
        open += 1;
      },
      close: () => {
        open -= 1;
      },
      message: (socket, data) => {
        const { id, method } = Schema.decodeUnknownSync(
          Schema.fromJsonString(
            Schema.Struct({ id: Schema.Int, method: Schema.String }),
          ),
        )(String(data));

        if (method === 'Echo') {
          socket.send(JSON.stringify({ id, result: { method } }));
        } else if (method === 'Fail') {
          socket.send(JSON.stringify({ id, error: { message: 'refused' } }));
        }
      },
    },
  });

  servers.push(server);

  return {
    url: `ws://127.0.0.1:${server.port}/devtools/browser/test`,
    open: () => open,
  };
}

test('a DevTools client interrupted while waiting leaves no connection open', async () => {
  const server = devtools();
  const fiber = Effect.runFork(
    Effect.scoped(
      Effect.gen(function* () {
        const cdp = yield* connectCdp(server.url, 30_000);

        expect(yield* cdp.send('Echo')).toEqual({ method: 'Echo' });

        return yield* cdp.send('Hang');
      }),
    ),
  );

  await expect.poll(server.open).toBe(1);
  await Effect.runPromise(Fiber.interrupt(fiber));
  await expect.poll(server.open).toBe(0);
});

test('a DevTools command fails on an error reply and on its timeout', async () => {
  const server = devtools();
  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const cdp = yield* connectCdp(server.url, 200);

        return [
          yield* Effect.flip(cdp.send('Fail')),
          yield* Effect.flip(cdp.send('Hang')),
        ];
      }),
    ),
  );

  expect(result.map((failure) => failure.message)).toEqual([
    'refused',
    'DevTools command Hang timed out after 0.2 seconds',
  ]);
  await expect.poll(server.open).toBe(0);
});
