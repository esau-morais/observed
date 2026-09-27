import { DateTime, Effect, Option, Schema } from 'effect';
import type { EvidenceValue } from '../../evidence-kinds';
import type { Operation } from '../../evidence-kinds/api';
import type { Collector, DirectContext } from './define';

type Recorded = EvidenceValue<'api'>['operations'][number];

const timeoutMs = 10_000;
const maxBodyBytes = 1_048_576;

function requestHeaders(
  operation: Operation,
  environment: DirectContext['environment'],
): Headers {
  const headers = new Headers();

  for (const header of operation.headers ?? []) {
    if ('value' in header) {
      headers.append(header.name, header.value);
    } else {
      const value = environment.get(header.env);

      if (value === undefined) {
        throw new Error(`Header value for ${header.env} was not resolved`);
      }

      headers.append(header.name, `${header.prefix ?? ''}${value}`);
    }
  }

  if (operation.body !== undefined && !headers.has('content-type')) {
    headers.set(
      'content-type',
      'json' in operation.body
        ? 'application/json'
        : 'text/plain;charset=UTF-8',
    );
  }

  return headers;
}

// Stops reading past the limit, so an unexpectedly large body is not held in
// memory.
async function readBody(response: Response) {
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;

  if (reader === undefined) {
    return { kind: 'bytes', bytes: new Uint8Array() } as const;
  }

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    bytes += value.byteLength;

    if (bytes > maxBodyBytes) {
      await reader.cancel();

      return { kind: 'too-large', bytes } as const;
    }

    chunks.push(value);
  }

  return { kind: 'bytes', bytes: Buffer.concat(chunks) } as const;
}

function decodeBody(
  contentType: string | null,
  bytes: Uint8Array,
): Extract<Recorded['result'], { kind: 'response' }>['body'] {
  if (bytes.byteLength === 0) {
    return { kind: 'empty' };
  }

  const text = new TextDecoder().decode(bytes);

  if (contentType !== null && /[/+]json\b/i.test(contentType)) {
    const value = Schema.decodeUnknownOption(
      Schema.fromJsonString(Schema.Json),
    )(text);

    if (Option.isSome(value)) {
      return { kind: 'json', value: value.value };
    }
  }

  return { kind: 'text', text };
}

function send(operation: Operation, context: DirectContext) {
  return Effect.gen(function* () {
    const startedAt = DateTime.formatIso(yield* DateTime.now);
    const started = performance.now();
    const headers = yield* Effect.sync(() =>
      requestHeaders(operation, context.environment),
    );
    const result = yield* Effect.tryPromise({
      try: async (signal): Promise<Recorded['result']> => {
        const response = await fetch(new URL(operation.path, context.url), {
          method: operation.method,
          headers,
          redirect: 'manual',
          signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
          ...(operation.body === undefined
            ? {}
            : {
                body:
                  'json' in operation.body
                    ? JSON.stringify(operation.body.json)
                    : operation.body.text,
              }),
        });
        const contentType = response.headers.get('content-type');
        const body = await readBody(response);

        return {
          kind: 'response',
          status: response.status,
          headers: [...response.headers].map(([name, value]) => ({
            name,
            value,
          })),
          body:
            body.kind === 'too-large'
              ? { kind: 'too-large', bytes: body.bytes }
              : decodeBody(contentType, body.bytes),
        };
      },
      catch: (cause) => cause,
    }).pipe(
      Effect.catch((cause) =>
        Effect.succeed<Recorded['result']>({
          kind: 'failed',
          reason:
            cause instanceof DOMException && cause.name === 'TimeoutError'
              ? `No response within ${timeoutMs / 1000} s`
              : `Request failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
      ),
    );

    return {
      request: operation,
      startedAt,
      durationMs: Math.round(performance.now() - started),
      result,
    } satisfies Recorded;
  });
}

// Sends each operation in order to the application's own origin, after the
// browser journey, and records the response even when an earlier one failed.
export const api: Collector<'api'> = {
  phase: 'no-browser',
  producer: { name: 'bun-fetch', version: Bun.version },
  conditions: () => ({ timeoutMs, maxBodyBytes, redirects: 'not followed' }),
  collect: ({ operations }, context) =>
    Effect.forEach(operations, (operation) => send(operation, context)).pipe(
      Effect.map((recorded) => ({ operations: recorded })),
    ),
};
