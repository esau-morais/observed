import { BunServices } from '@effect/platform-bun';
import { Effect, Schema } from 'effect';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import shop from '../examples/shop/observed.json';
import { compareContract } from '../src/api-contract';
import { api as collector } from '../src/capture/collectors/api';
import { resolveCollectorEnvironment } from '../src/capture/collectors';
import { apiReadback, apiSchema, apiStatus } from '../src/checks/api';
import type { Observations } from '../src/capture/model';
import { json } from '../src/encoding';
import type { OperationRecord as Recorded } from '../src/evidence-kinds/api';
import { jsonSchema, validateJson } from '../src/json-schema';
import { loadProject } from '../src/project';

const observations: Observations = {
  schemaVersion: 3,
  requests: [],
  browserErrors: [],
  window: {
    startedAt: '2026-09-27T12:00:00.000Z',
    finishedAt: '2026-09-27T12:00:01.000Z',
  },
};

function recorded(
  id: string,
  result: Recorded['result'],
  method = 'GET',
): Recorded {
  return {
    request: { id, method, path: `/api/${id}` },
    startedAt: '2026-09-27T12:00:00.500Z',
    durationMs: 3,
    result,
  };
}

const answered = (status: number, value: Schema.Json): Recorded['result'] => ({
  kind: 'response',
  status,
  headers: [{ name: 'content-type', value: 'application/json' }],
  body: { kind: 'json', value },
});

const side = (operations: Recorded[]) => ({
  observations,
  evidence: { api: { operations } },
});

const identity = { id: 'check', name: 'Check', scope: 'One operation.' };

const stationSchema = Schema.decodeUnknownSync(jsonSchema)({
  type: 'object',
  required: ['stations'],
  properties: {
    stations: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'average'],
        properties: { id: { type: 'string' }, average: { type: 'number' } },
      },
    },
  },
});

test('a removed required field and a retyped field each fail the schema', () => {
  expect(
    validateJson(stationSchema, {
      stations: [{ id: 'north' }, { id: 5, average: 12.6 }],
    }),
  ).toEqual([
    '/stations/0/average is missing',
    '/stations/1/id is number, expected string',
  ]);
});

test('accepts the JSON Schema that Effect generates for a project schema', () => {
  const station = Schema.Struct({ id: Schema.String, average: Schema.Number });
  const schema = Schema.decodeUnknownSync(jsonSchema, {
    onExcessProperty: 'error',
  })(Schema.toJsonSchemaDocument(station).schema);

  expect(validateJson(schema, { id: 'north', average: '12.6' })).toEqual([
    '/average matches none of the anyOf alternatives',
  ]);
});

test('contract changes are listed at their outermost path', () => {
  const base = recorded(
    'stations',
    answered(200, {
      stations: [{ id: 'north', average: 12.6, latest: 12.8 }],
      meta: { page: 1 },
    }),
  );
  const candidate = recorded(
    'stations',
    answered(200, {
      stations: [{ id: 'north', latest: '12.8', unit: 'C' }],
      links: { next: null, previous: null },
    }),
  );

  expect(compareContract(base, candidate)).toEqual({
    kind: 'compared',
    changes: [
      { kind: 'added', path: 'links', type: 'object' },
      { kind: 'removed', path: 'meta', type: 'object' },
      { kind: 'removed', path: 'stations[].average', type: 'number' },
      {
        kind: 'retyped',
        path: 'stations[].latest',
        base: 'number',
        candidate: 'string',
      },
      { kind: 'added', path: 'stations[].unit', type: 'string' },
    ],
  });
});

test('fields inside an array that is empty on one side are not compared', () => {
  expect(
    compareContract(
      recorded('tasks', answered(200, { tasks: [] })),
      recorded('tasks', answered(200, { tasks: [{ id: 1 }] })),
    ),
  ).toEqual({ kind: 'compared', changes: [] });
});

test('a wrong status fails, and a request without a response is unknown', () => {
  const evaluate = (operations: Recorded[]) =>
    apiStatus.evaluate({
      definition: {
        kind: 'api-status',
        ...identity,
        operation: 'create',
        status: 201,
      },
      base: null,
      candidate: side(operations),
      comparable: false,
    }).candidate;

  expect(
    evaluate([recorded('create', answered(200, { id: 1 }), 'POST')]),
  ).toEqual({
    outcome: 'failed',
    actual: 200,
    detail: 'POST /api/create answered 200, expected 201.',
  });
  expect(
    evaluate([
      recorded(
        'create',
        { kind: 'failed', reason: 'No response within 10 s' },
        'POST',
      ),
    ]).outcome,
  ).toBe('unknown');
});

test.each(['[REDACTED]', 'https://%5BREDACTED%5D@api.example/'])(
  'a readback of the redacted value %s is unknown, not a match',
  (redacted) => {
    expect(
      apiReadback.evaluate({
        definition: {
          kind: 'api-readback',
          ...identity,
          operation: 'create',
          readback: 'read',
          pointer: '/token',
          expected: redacted,
        },
        base: null,
        candidate: side([
          recorded('create', answered(201, {}), 'POST'),
          recorded('read', answered(200, { token: redacted })),
        ]),
        comparable: false,
      }).candidate.outcome,
    ).toBe('unknown');
  },
);

test('a schema check is unknown when the body was too large to record', () => {
  expect(
    apiSchema.evaluate({
      definition: {
        kind: 'api-schema',
        ...identity,
        operation: 'stations',
        schema: stationSchema,
      },
      base: null,
      candidate: side([
        recorded('stations', {
          kind: 'response',
          status: 200,
          headers: [],
          body: { kind: 'too-large', bytes: 2_000_000 },
        }),
      ]),
      comparable: false,
    }).candidate.outcome,
  ).toBe('unknown');
});

test('a readback passes only after a successful write returns the value', () => {
  const evaluate = (write: Recorded['result'], read: Recorded['result']) =>
    apiReadback.evaluate({
      definition: {
        kind: 'api-readback',
        ...identity,
        operation: 'create',
        readback: 'read',
        pointer: '/readings/4',
        expected: 13.2,
      },
      base: null,
      candidate: side([
        recorded('create', write, 'POST'),
        recorded('read', read),
      ]),
      comparable: false,
    }).candidate;
  const readings = answered(200, { readings: [12.1, 12.4, 13.0, 12.8, 13.2] });

  expect(evaluate(answered(201, { ok: true }), readings).outcome).toBe(
    'passed',
  );
  // The value already present does not confirm a write that was refused.
  expect(evaluate(answered(403, { error: 'forbidden' }), readings)).toEqual({
    outcome: 'failed',
    actual: 'write answered 403',
    detail:
      'POST /api/create answered 403, so there is no side effect to read back.',
  });
  expect(
    evaluate(
      answered(201, { ok: true }),
      answered(200, { readings: [12.1, 12.4, 13.0, 12.8] }),
    ).outcome,
  ).toBe('failed');
});

const echoCollector = {
  kind: 'api',
  operations: [
    {
      id: 'create',
      method: 'POST',
      path: '/api/readings',
      headers: [{ name: 'Authorization', env: 'API_TOKEN', prefix: 'Bearer ' }],
      body: { json: { value: 13.2 } },
    },
  ],
} as const;

function collect(url: string, environment = new Map<string, string>()) {
  return Effect.runPromise(
    collector.phase === 'no-browser'
      ? collector
          .collect(echoCollector, { url, environment })
          .pipe(Effect.provide(BunServices.layer))
      : Effect.die('The api collector must not use a browser'),
  );
}

test('sends the header value from the environment it resolves', async () => {
  const token = 'fixture-token-6f1c';
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) =>
      Response.json(
        {
          echoed: request.headers.get('authorization'),
          body: await request.text(),
        },
        { status: 201 },
      ),
  });

  try {
    const environment = await Effect.runPromise(
      resolveCollectorEnvironment([echoCollector], { API_TOKEN: token }),
    );
    const value = await collect(server.url.href, environment);

    expect(value.operations[0]?.result).toMatchObject({
      kind: 'response',
      status: 201,
      body: {
        kind: 'json',
        value: { echoed: `Bearer ${token}`, body: '{"value":13.2}' },
      },
    });
  } finally {
    await server.stop(true);
  }
});

// Each of these would otherwise fail the whole capture or hold the body in
// memory; recorded, they leave the operation's checks unknown.
test('records an oversized body by size, an unsendable header and a refused connection', async () => {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Response('x'.repeat(1_048_577)),
  });
  const token = new Map([['API_TOKEN', 'fixture-token']]);

  try {
    expect(
      (await collect(server.url.href, token)).operations[0]?.result,
    ).toMatchObject({ kind: 'response', body: { kind: 'too-large' } });
    expect(
      (await collect(server.url.href, new Map([['API_TOKEN', 'a\nb']])))
        .operations[0]?.result.kind,
    ).toBe('failed');
  } finally {
    await server.stop(true);
  }

  expect(
    (await collect(server.url.href, token)).operations[0]?.result.kind,
  ).toBe('failed');
});

// CI commonly expands an unavailable secret to an empty string.
test('fails the capture when a header variable is missing or empty', async () => {
  const failure = await Effect.runPromise(
    Effect.flip(
      resolveCollectorEnvironment([echoCollector], { API_TOKEN: '' }),
    ),
  );

  expect(failure.message).toContain('API_TOKEN');
});

async function load(config: unknown) {
  const root = await mkdtemp(path.join(tmpdir(), 'observed-project-'));

  try {
    await writeFile(path.join(root, 'observed.json'), json(config));

    return await Effect.runPromise(
      loadProject(root).pipe(
        Effect.map(() => 'loaded'),
        Effect.catchTag('ProjectFailure', (error) =>
          Effect.succeed(error.message),
        ),
        Effect.provide(BunServices.layer),
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const operations = [
  { id: 'create', method: 'POST', path: '/api/readings' },
  { id: 'read', method: 'GET', path: '/api/readings' },
];

test.each([
  [
    'names an operation the collector does not list',
    { kind: 'api-status', operation: 'delete', status: 204 },
    'names operation delete, which the api collector does not list',
  ],
  [
    'reads back before the write',
    {
      kind: 'api-readback',
      operation: 'read',
      readback: 'create',
      pointer: '',
      expected: null,
    },
    'must come after read',
  ],
])('rejects a check that %s', async (_label, check, message) => {
  expect(
    await load({
      ...shop,
      capture: {
        ...shop.capture,
        collectors: [{ kind: 'api', operations }],
        checks: [{ ...identity, ...check }],
      },
    }),
  ).toContain(message);
});

test('rejects an unsupported JSON Schema keyword instead of ignoring it', async () => {
  expect(
    await load({
      ...shop,
      capture: {
        ...shop.capture,
        collectors: [{ kind: 'api', operations }],
        checks: [
          {
            ...identity,
            kind: 'api-schema',
            operation: 'read',
            schema: {
              type: 'object',
              properties: { name: { type: 'string', minLength: 1 } },
            },
          },
        ],
      },
    }),
  ).toContain('minLength');
});

test('rejects a literal credential header', async () => {
  expect(
    await load({
      ...shop,
      capture: {
        ...shop.capture,
        collectors: [
          {
            kind: 'api',
            operations: [
              {
                ...operations[0],
                headers: [{ name: 'Authorization', value: 'Bearer abc123' }],
              },
            ],
          },
        ],
      },
    }),
  ).toContain('credentials');
});
