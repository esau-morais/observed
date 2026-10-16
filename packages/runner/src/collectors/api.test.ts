import { Effect } from 'effect';
import { createServer, type RequestListener } from 'node:http';
import { expect, test } from 'vitest';
import { collectApi } from './api';

const create = {
  id: 'create',
  method: 'POST',
  path: '/api/readings',
  headers: [{ name: 'Authorization', env: 'API_TOKEN', prefix: 'Bearer ' }],
  body: { json: { value: 13.2 } },
} as const;

async function serve(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  if (address === null || typeof address === 'string') {
    throw new Error('The test server has no TCP address');
  }

  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      ),
  };
}

const collect = (url: string, token: string) =>
  Effect.runPromise(collectApi([create], { url, environment: new Map([['API_TOKEN', token]]) }));

test('sends the header value from the environment and records the JSON response', async () => {
  const server = await serve((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString()));
    request.on('end', () => {
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ echoed: request.headers.authorization, body }));
    });
  });

  try {
    expect((await collect(server.url, 'fixture-token-6f1c')).operations[0]?.result).toMatchObject({
      kind: 'response',
      status: 201,
      body: {
        kind: 'json',
        value: { echoed: 'Bearer fixture-token-6f1c', body: '{"value":13.2}' },
      },
    });
  } finally {
    await server.close();
  }
});

// Each of these would otherwise fail the whole capture or hold the body in
// memory; recorded, they leave the operation's checks unknown.
test('records an oversized body by size, an unsendable header and a refused connection', async () => {
  const server = await serve((_request, response) => {
    response.end('x'.repeat(1_048_577));
  });

  try {
    expect((await collect(server.url, 'fixture-token')).operations[0]?.result).toMatchObject({
      kind: 'response',
      body: { kind: 'too-large' },
    });
    expect((await collect(server.url, 'a\nb')).operations[0]?.result.kind).toBe('failed');
  } finally {
    await server.close();
  }

  expect((await collect(server.url, 'fixture-token')).operations[0]?.result.kind).toBe('failed');
});
