import { Effect, Schema } from 'effect';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const selectSchema = Schema.Union([
  Schema.String,
  Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  Schema.Struct({ key: Schema.String, equals: Schema.Json }),
]);

const readingSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('json'),
    file: Schema.String,
    path: Schema.Array(selectSchema),
  }),
  Schema.Struct({
    kind: Schema.Literal('requests'),
    file: Schema.String,
    method: Schema.String,
    pathname: Schema.String,
    status: Schema.Int,
  }),
]);

export const expectationSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  gate: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8 })),
  reason: Schema.NonEmptyString,
  exitCode: Schema.Literals([0, 1, 2]),
  assertions: Schema.NonEmptyArray(
    Schema.Struct({
      label: Schema.NonEmptyString,
      actual: readingSchema,
      expected: Schema.Json,
      raw: Schema.optionalKey(readingSchema),
    }),
  ),
});

export type Expectation = typeof expectationSchema.Type;
export type Reading = typeof readingSchema.Type;
type Selector = typeof selectSchema.Type;

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));

function field(value: Schema.Json, key: string | number): Schema.Json {
  if (key === 'length' && Array.isArray(value)) {
    return value.length;
  }

  if (value === null || typeof value !== 'object') {
    throw new Error(`Cannot read ${key} from ${JSON.stringify(value)}`);
  }

  const object = Schema.decodeUnknownSync(
    Schema.Record(Schema.String, Schema.Json),
  )(Array.isArray(value) ? Object.fromEntries(value.entries()) : value);
  const found = object[String(key)];

  if (found === undefined) {
    throw new Error(`Missing field ${key}`);
  }

  return found;
}

export function select(
  value: Schema.Json,
  selectors: readonly Selector[],
): Schema.Json {
  let current = value;

  for (const selector of selectors) {
    if (typeof selector !== 'object') {
      current = field(current, selector);
      continue;
    }

    const values = Schema.decodeUnknownSync(Schema.Array(Schema.Json))(current);
    const matches = values.filter((item) =>
      isDeepStrictEqual(field(item, selector.key), selector.equals),
    );

    if (matches.length !== 1 || matches[0] === undefined) {
      throw new Error(
        `Expected one match for ${JSON.stringify(selector)}, found ${matches.length}`,
      );
    }

    current = matches[0];
  }

  return current;
}

async function readContained(root: string, filename: string) {
  const directory = await realpath(root);
  const resolved = await realpath(path.resolve(directory, filename));
  const relative = path.relative(directory, resolved);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Reading outside the run is forbidden: ${filename}`);
  }

  return decodeJson(await readFile(resolved, 'utf8'));
}

const harSchema = Schema.Struct({
  log: Schema.Struct({
    entries: Schema.Array(
      Schema.Struct({
        request: Schema.Struct({ method: Schema.String, url: Schema.String }),
        response: Schema.Struct({ status: Schema.Int }),
      }),
    ),
  }),
});

async function read(root: string, reading: Reading) {
  const value = await readContained(root, reading.file);

  if (reading.kind === 'json') {
    return select(value, reading.path);
  }

  const har = Schema.decodeUnknownSync(harSchema)(value);
  const requests = har.log.entries.filter(
    (entry) =>
      entry.request.method === reading.method &&
      new URL(entry.request.url).pathname === reading.pathname,
  );

  if (requests.some((entry) => entry.response.status !== reading.status)) {
    throw new Error(`Unexpected HTTP status in ${reading.file}`);
  }

  return requests.length;
}

export async function checkRun(
  root: string,
  expectation: Expectation,
  exitCode: number,
) {
  const failures: string[] = [];

  if (exitCode !== expectation.exitCode) {
    failures.push(
      `exit: expected ${expectation.exitCode}, received ${exitCode}`,
    );
  }

  for (const assertion of expectation.assertions) {
    try {
      const actual = await read(root, assertion.actual);

      if (!isDeepStrictEqual(actual, assertion.expected)) {
        failures.push(
          `${assertion.label}: expected ${JSON.stringify(assertion.expected)}, received ${JSON.stringify(actual)}`,
        );
      }

      if (assertion.raw !== undefined) {
        const raw = await read(root, assertion.raw);

        if (
          !isDeepStrictEqual(raw, assertion.expected) ||
          !isDeepStrictEqual(raw, actual)
        ) {
          failures.push(
            `${assertion.label}: raw producer value ${JSON.stringify(raw)} disagrees with expected/result value`,
          );
        }
      }
    } catch (cause) {
      failures.push(`${assertion.label}: ${String(cause)}`);
    }
  }

  return {
    id: expectation.id,
    gate: expectation.gate,
    passed: failures.length === 0,
    failures,
  };
}

if (import.meta.main) {
  await Effect.runPromise(
    Effect.tryPromise(async () => {
      const [root, expectedFile, exitFile] = process.argv.slice(2);

      if (
        root === undefined ||
        expectedFile === undefined ||
        exitFile === undefined
      ) {
        throw new Error(
          'Usage: bun scripts/gate-corpus/check.ts RUN EXPECTATIONS EXIT_JSON',
        );
      }

      const expected = Schema.decodeUnknownSync(
        Schema.fromJsonString(expectationSchema),
      )(await readFile(expectedFile, 'utf8'));
      const exit = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Int))(
        await readFile(exitFile, 'utf8'),
      );
      const result = await checkRun(root, expected, exit);

      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.passed ? 0 : 1;
    }),
  );
}
