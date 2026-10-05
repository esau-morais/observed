import { Effect, Schema } from 'effect';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const selectSchema = Schema.Union([
  Schema.String,
  Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  Schema.Struct({ key: Schema.String, equals: Schema.Json }),
]);

const natural = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const positive = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

const readingSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('png-different'),
    file: Schema.String,
    other: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal('timeline-state'),
    file: Schema.String,
    side: Schema.Literals(['base', 'candidate']),
    includes: Schema.NonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal('load-budget'),
    file: Schema.String,
    side: Schema.Literals(['base', 'candidate']),
    check: Schema.NonEmptyString,
    max: Schema.Number.check(
      Schema.isFinite(),
      Schema.isGreaterThanOrEqualTo(0),
    ),
    samples: positive,
    warmup: positive,
  }),
  Schema.Struct({
    kind: Schema.Literal('text'),
    file: Schema.String,
    includes: Schema.NonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal('coverage'),
    file: Schema.String,
    pathname: Schema.String,
    source: Schema.String,
    line: positive,
    column: natural,
    functionRange: Schema.Struct({ startOffset: natural, endOffset: positive }),
    measure: Schema.optionalKey(Schema.Literal('count')),
  }),
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

async function readContainedFile(root: string, filename: string) {
  const directory = await realpath(root);
  const resolved = await realpath(path.resolve(directory, filename));
  const relative = path.relative(directory, resolved);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Reading outside the run is forbidden: ${filename}`);
  }

  return readFile(resolved);
}

async function readContainedText(root: string, filename: string) {
  return (await readContainedFile(root, filename)).toString('utf8');
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

const coverageSchema = Schema.Struct({
  result: Schema.Array(
    Schema.Struct({
      url: Schema.String,
      functions: Schema.Array(
        Schema.Struct({
          ranges: Schema.Array(
            Schema.Struct({
              startOffset: natural,
              endOffset: natural,
              count: natural,
            }),
          ),
        }),
      ),
    }),
  ),
});

function covered(
  value: Schema.Json,
  source: string,
  reading: Extract<Reading, { kind: 'coverage' }>,
) {
  const scripts = Schema.decodeUnknownSync(coverageSchema)(value).result.filter(
    (script) => {
      try {
        return new URL(script.url).pathname === reading.pathname;
      } catch {
        return false;
      }
    },
  );
  const script = scripts[0];
  if (scripts.length !== 1 || script === undefined) {
    throw new Error(
      `Expected one coverage script for ${reading.pathname}, found ${scripts.length}`,
    );
  }

  const lines = source.split('\n');
  const line = lines[reading.line - 1];
  if (line === undefined || reading.column >= line.length) {
    throw new Error('Coverage position is outside the captured source');
  }

  const offset =
    lines
      .slice(0, reading.line - 1)
      .reduce((sum, text) => sum + text.length + 1, 0) + reading.column;
  const functions = script.functions.filter((fn) =>
    fn.ranges.some(
      (range) =>
        range.startOffset === reading.functionRange.startOffset &&
        range.endOffset === reading.functionRange.endOffset,
    ),
  );
  const handler = functions[0];
  if (
    functions.length !== 1 ||
    handler === undefined ||
    offset < reading.functionRange.startOffset ||
    offset >= reading.functionRange.endOffset
  ) {
    throw new Error('Missing or ambiguous protected function coverage');
  }

  const ranges = handler.ranges;
  if (
    ranges.some(
      (range) =>
        range.endOffset <= range.startOffset || range.endOffset > source.length,
    )
  ) {
    throw new Error('Invalid producer coverage range');
  }

  const covering = ranges.filter(
    (range) => range.startOffset <= offset && offset < range.endOffset,
  );
  const inner = covering.filter(
    (range) =>
      !covering.some(
        (other) =>
          other.startOffset >= range.startOffset &&
          other.endOffset <= range.endOffset &&
          (other.startOffset > range.startOffset ||
            other.endOffset < range.endOffset),
      ),
  );
  if (inner.length !== 1 || inner[0] === undefined) {
    throw new Error('Missing or ambiguous innermost coverage range');
  }

  return reading.measure === 'count' ? inner[0].count : inner[0].count > 0;
}

async function read(root: string, reading: Reading) {
  if (reading.kind === 'png-different') {
    const images = await Promise.all(
      [reading.file, reading.other].map((file) =>
        readContainedFile(root, file),
      ),
    );
    const [before, after] = images;
    if (
      before === undefined ||
      after === undefined ||
      images.some(
        (bytes) =>
          bytes.length < 33 ||
          bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a',
      )
    ) {
      throw new Error('Expected two PNG artifacts');
    }

    return !before.equals(after);
  }

  if (reading.kind === 'text') {
    return (await readContainedText(root, reading.file)).includes(
      reading.includes,
    );
  }

  const value = decodeJson(await readContainedText(root, reading.file));

  if (reading.kind === 'timeline-state') {
    const side = select(value, ['journeys', 0, reading.side]);
    const timeline = Schema.decodeUnknownSync(
      Schema.Struct({
        steps: Schema.Array(
          Schema.Struct({
            index: natural,
            action: Schema.NonEmptyString,
            outcome: Schema.Literal('completed'),
          }),
        ),
        finalState: Schema.Struct({
          kind: Schema.Literal('recorded'),
          tree: Schema.NonEmptyString,
        }),
      }),
    )(recordedEvidence(side, 'timeline'));
    const recipe = Schema.decodeUnknownSync(
      Schema.fromJsonString(
        Schema.Struct({
          steps: Schema.Array(Schema.Struct({ kind: Schema.NonEmptyString })),
        }),
      ),
    )(await readContainedText(root, `journey-1/${reading.side}/recipe.json`));
    if (
      timeline.steps.length !== recipe.steps.length ||
      timeline.steps.some(
        (step, index) =>
          step.index !== index || step.action !== recipe.steps[index]?.kind,
      )
    ) {
      throw new Error('Timeline steps differ from the protected recipe');
    }

    const state = timeline.finalState;
    const producer = Schema.decodeUnknownSync(
      Schema.fromJsonString(
        Schema.Struct({
          success: Schema.Literal(true),
          data: Schema.Struct({ snapshot: Schema.NonEmptyString }),
        }),
      ),
    )(await readContainedText(root, `journey-1/${reading.side}/snapshot.json`));
    if (state.tree !== producer.data.snapshot) {
      throw new Error('Timeline state disagrees with the raw snapshot');
    }

    return state.tree.includes(reading.includes);
  }

  if (reading.kind === 'load-budget') {
    return loadBudget(root, value, reading);
  }

  if (reading.kind === 'coverage') {
    const source = await readContainedText(root, reading.source);

    return covered(value, source, reading);
  }

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

function recordedEvidence(side: Schema.Json, kind: string): Schema.Json {
  Schema.decodeUnknownSync(Schema.Literal('complete'))(
    select(side, ['execution']),
  );
  const evidence = Schema.decodeUnknownSync(
    Schema.Struct({ status: Schema.Literal('recorded'), value: Schema.Json }),
  )(select(side, ['evidence', { key: 'kind', equals: kind }]));

  return evidence.value;
}

async function loadBudget(
  root: string,
  result: Schema.Json,
  reading: Extract<Reading, { kind: 'load-budget' }>,
) {
  const side = select(result, ['journeys', 0, reading.side]);
  const evidence = recordedEvidence(side, 'performance');
  const samples = Schema.decodeUnknownSync(Schema.Array(Schema.Json))(
    select(evidence, ['samples']),
  );
  if (
    samples.length !== reading.samples + reading.warmup ||
    select(evidence, ['conditions', 'samples']) !== reading.samples ||
    select(evidence, ['conditions', 'warmup']) !== reading.warmup
  ) {
    throw new Error(
      'Timing sample counts differ from the protected expectation',
    );
  }

  const measured: number[] = [];
  const origins = new Set<number>();
  const numeric = Schema.Number.check(
    Schema.isFinite(),
    Schema.isGreaterThanOrEqualTo(0),
  );
  const producer = Schema.Struct({
    success: Schema.Literal(true),
    data: Schema.Struct({
      result: Schema.fromJsonString(
        Schema.Struct({
          observer: Schema.Literal(true),
          timeOrigin: numeric,
          document: Schema.Literal('/'),
          load: numeric,
        }),
      ),
    }),
  });
  for (const [index, sample] of samples.entries()) {
    const run = index + 1;
    const rawFile = `journey-1/${reading.side}/performance/run-${String(run).padStart(2, '0')}.json`;
    const raw = Schema.decodeUnknownSync(Schema.fromJsonString(producer))(
      await readContainedText(root, rawFile),
    ).data.result;
    if (origins.has(raw.timeOrigin)) {
      throw new Error('Timing runs reused a document');
    }

    origins.add(raw.timeOrigin);
    if (
      select(sample, ['run']) !== run ||
      select(sample, ['warmup']) !== index < reading.warmup ||
      select(sample, ['document']) !== raw.document ||
      select(sample, ['metrics', 'load']) !== raw.load
    ) {
      throw new Error(`Load sample ${run} disagrees with raw producer output`);
    }

    if (index >= reading.warmup) {
      measured.push(raw.load);
    }
  }

  measured.sort((a, b) => a - b);
  const upper = measured[Math.floor(measured.length / 2)];
  const lower = measured[Math.floor((measured.length - 1) / 2)];
  if (upper === undefined || lower === undefined) {
    throw new Error('No measured timing samples');
  }

  const median = (lower + upper) / 2;
  const check = Schema.decodeUnknownSync(
    Schema.Struct({
      outcome: Schema.Literals(['passed', 'failed']),
      actual: Schema.NonEmptyString,
    }),
  )(select(side, ['checks', { key: 'id', equals: reading.check }]));
  const withinBudget = median <= reading.max;
  if (check.outcome !== (withinBudget ? 'passed' : 'failed')) {
    throw new Error('Check outcome disagrees with the raw load budget');
  }

  const format = (value: number) =>
    `${value < 10 ? value.toFixed(1) : Math.round(value)} ms`;
  const summary = `median ${format(median)} over ${measured.length} samples, range ${format(measured[0] ?? median)} to ${format(measured.at(-1) ?? median)}`;
  if (check.actual !== summary) {
    throw new Error('Check measurement disagrees with the raw load samples');
  }

  return withinBudget;
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
