import { Option, Schema } from 'effect';
import type { PlaywrightAttachment } from '../evidence-kinds/playwright';
import { readZip, ZipError } from './zip';

type Trace = NonNullable<PlaywrightAttachment['trace']>;

const nonNegative = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const contextOptions = Schema.fromJsonString(
  Schema.Struct({
    type: Schema.Literal('context-options'),
    origin: Schema.optionalKey(Schema.String),
    browserName: Schema.String,
    channel: Schema.optionalKey(Schema.String),
    playwrightVersion: Schema.String,
    platform: Schema.String,
    title: Schema.optionalKey(Schema.String),
    options: Schema.Struct({
      viewport: Schema.optionalKey(
        Schema.Struct({ width: nonNegative, height: nonNegative }),
      ),
    }),
  }),
);

const decodeContext = Schema.decodeUnknownOption(contextOptions);

// The browser context's trace, such as 0-trace.trace, starts with the
// context-options event. test.trace belongs to the test runner.
const contextTrace = /^[0-9]+-trace\.trace$/;

const maxTraceEntry = 256 * 1024 * 1024;

// Summarizes a trace zip so the report can say what it recorded without
// opening it. Viewing the trace is left to Playwright's own viewer.
export function summarizeTrace(bytes: Uint8Array): Trace {
  let entries;

  try {
    entries = readZip(bytes, maxTraceEntry);
  } catch (cause) {
    return unreadable(cause);
  }

  const names = [...entries.keys()].filter((name) => contextTrace.test(name));

  if (names.length === 0) {
    return {
      kind: 'unavailable',
      reason: 'The zip holds no browser context trace',
    };
  }

  const [name] = names.sort();
  const entry = name === undefined ? undefined : entries.get(name);

  if (entry === undefined) {
    return {
      kind: 'unavailable',
      reason: 'The zip holds no browser context trace',
    };
  }

  let firstLine;

  try {
    const content = entry.read();
    const newline = content.indexOf(10);
    firstLine = new TextDecoder().decode(
      newline === -1 ? content : content.subarray(0, newline),
    );
  } catch (cause) {
    return unreadable(cause);
  }

  const context = decodeContext(firstLine);

  if (Option.isNone(context)) {
    return {
      kind: 'unavailable',
      reason: `${name} does not start with a context-options event this Observed reads`,
    };
  }

  const value = context.value;

  return {
    kind: 'recorded',
    title: value.title ?? null,
    browser: value.browserName,
    channel: value.channel ?? null,
    playwrightVersion: value.playwrightVersion,
    platform: value.platform,
    viewport: value.options.viewport ?? null,
  };
}

function unreadable(cause: unknown): Trace {
  return {
    kind: 'unavailable',
    reason: `The trace zip is unreadable: ${cause instanceof ZipError ? cause.message : 'unexpected error'}`,
  };
}
