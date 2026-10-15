import { Schema } from 'effect';
import { expect, test } from 'vitest';
import type { Observations } from '../capture';
import type { OperationRecord as Recorded } from '../evidence/api';
import { journeyRecipe, savedJourneySchema } from '../journey';
import { jsonSchema, validateJson } from '../json-schema';
import { recipeSchema } from '../recipe';
import { apiReadback, apiSchema, apiStatus } from './api';

const observations: Observations = {
  schemaVersion: 3,
  requests: [],
  browserErrors: [],
  window: {
    startedAt: '2026-09-27T12:00:00.000Z',
    finishedAt: '2026-09-27T12:00:01.000Z',
  },
};

function recorded(id: string, result: Recorded['result'], method = 'GET'): Recorded {
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
  ).toEqual(['/stations/0/average is missing', '/stations/1/id is number, expected string']);
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

  expect(evaluate([recorded('create', answered(200, { id: 1 }), 'POST')])).toEqual({
    outcome: 'failed',
    actual: 200,
    detail: 'POST /api/create answered 200, expected 201.',
  });
  expect(
    evaluate([recorded('create', { kind: 'failed', reason: 'No response within 10 s' }, 'POST')])
      .outcome,
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
      candidate: side([recorded('create', write, 'POST'), recorded('read', read)]),
      comparable: false,
    }).candidate;
  const readings = answered(200, { readings: [12.1, 12.4, 13.0, 12.8, 13.2] });

  expect(evaluate(answered(201, { ok: true }), readings).outcome).toBe('passed');
  // The value already present does not confirm a write that was refused.
  expect(evaluate(answered(403, { error: 'forbidden' }), readings)).toEqual({
    outcome: 'failed',
    actual: 'write answered 403',
    detail: 'POST /api/create answered 403, so there is no side effect to read back.',
  });
  expect(
    evaluate(answered(201, { ok: true }), answered(200, { readings: [12.1, 12.4, 13.0, 12.8] }))
      .outcome,
  ).toBe('failed');
});

const operations = [
  { id: 'create', method: 'POST', path: '/api/readings' },
  { id: 'read', method: 'GET', path: '/api/readings' },
];

// Decodes a journey as the project loader does, then its recipe, and returns
// the first problem found.
function load(check: unknown): string {
  try {
    const journey = Schema.decodeUnknownSync(savedJourneySchema, {
      onExcessProperty: 'error',
    })({
      name: 'Readings',
      path: '/',
      ready: [],
      steps: [],
      collectors: [{ kind: 'api', operations }],
      checks: [check],
    });

    Schema.decodeUnknownSync(recipeSchema)(journeyRecipe(journey));

    return 'loaded';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

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
])('rejects a check that %s', (_label, check, message) => {
  expect(load({ ...identity, ...check })).toContain(message);
});

test('rejects an unsupported JSON Schema keyword instead of ignoring it', () => {
  expect(
    load({
      ...identity,
      kind: 'api-schema',
      operation: 'read',
      schema: {
        type: 'object',
        properties: { name: { type: 'string', minLength: 1 } },
      },
    }),
  ).toContain('minLength');
});
