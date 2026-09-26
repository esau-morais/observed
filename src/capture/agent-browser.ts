import { DateTime, Effect, FileSystem, Schema } from 'effect';
import path from 'node:path';
import {
  observationsSchema,
  type Conditions,
  type Observations,
} from './model';
import { processOutput } from './process';
import { json } from '../encoding';
import { conceal, redact, redactText } from '../redact';
import type { Recipe, Step } from './recipe';

export const producer = { name: 'agent-browser', version: '0.38.1' } as const;

export class BrowserFailure extends Schema.TaggedError<BrowserFailure>()(
  'BrowserFailure',
  { message: Schema.String },
) {}

const response = <S extends Schema.Constraint>(data: S) =>
  Schema.Struct({
    success: Schema.Literal(true),
    data,
  });

const sessionSchema = response(Schema.Struct({ active: Schema.Boolean }));

const filledSchema = Schema.Tuple([
  Schema.Struct({ success: Schema.Literal(true) }),
]);

const requestSchema = Schema.Struct({
  requestId: Schema.NonEmptyString,
  url: Schema.URLFromString,
  method: Schema.NonEmptyString,
  status: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

const requestsSchema = response(
  Schema.Struct({ requests: Schema.Array(requestSchema) }),
);

const errorsSchema = response(
  Schema.Struct({
    errors: Schema.Array(Schema.Struct({ text: Schema.String })),
  }),
);

const consoleSchema = response(
  Schema.Struct({
    messages: Schema.Array(
      Schema.Struct({ type: Schema.String, text: Schema.String }),
    ),
  }),
);

const environmentSchema = response(
  Schema.Struct({
    result: Schema.Struct({
      locale: Schema.NonEmptyString,
      timezone: Schema.NonEmptyString,
      width: Schema.Int,
      height: Schema.Int,
      scale: Schema.Number,
    }),
  }),
);

export const harSchema = Schema.Struct({
  log: Schema.Struct({
    version: Schema.Literal('1.2'),
    creator: Schema.Struct({
      name: Schema.Literal(producer.name),
      version: Schema.Literal(producer.version),
    }),
    browser: Schema.Struct({
      name: Schema.NonEmptyString,
      version: Schema.NonEmptyString,
    }),
    entries: Schema.Array(
      Schema.Struct({
        startedDateTime: Schema.DateTimeUtcFromString,
        request: Schema.Struct({
          method: Schema.NonEmptyString,
          url: Schema.URLFromString,
        }),
        response: Schema.Struct({
          status: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
        }),
      }),
    ),
  }),
});

const decode = <S extends Schema.Constraint>(schema: S, input: string) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(input);

export const captureBrowser = Effect.fn('captureBrowser')(function* (options: {
  projectRoot: string;
  directory: string;
  session: string;
  url: string;
  addArtifact: (id: string, filename: string, description: string) => void;
  recipe: Recipe;
  fillValues: ReadonlyMap<string, string>;
  inputsHash: string;
  dependenciesHash: string | null;
}) {
  const fs = yield* FileSystem.FileSystem;
  const temporary = yield* fs.makeTempDirectoryScoped({ prefix: 'obs-' });
  const config = path.join(options.directory, 'browser-config.json');
  const recipe = options.recipe;
  const origin = new URL(options.url).origin;
  const allowedOrigins = new Set([origin, ...(recipe.allowedOrigins ?? [])]);
  const concealed = [...options.fillValues.values()];

  yield* fs.writeFileString(config, '{}\n', { flag: 'wx' });

  options.addArtifact(
    'browser-config',
    'browser-config.json',
    'Explicit producer configuration',
  );

  const environment = {
    HOME: process.env.HOME,
    PATH: process.env.PATH,
    LANG: 'en_US.UTF-8',
    TZ: 'UTC',
    TMPDIR: temporary,
    AGENT_BROWSER_SOCKET_DIR: temporary,
    AGENT_BROWSER_DEFAULT_TIMEOUT: '20000',
  };

  const command = Effect.fnUntraced(function* (
    args: readonly string[],
    stdin?: string,
  ) {
    return yield* processOutput({
      command: process.execPath,
      args: [
        path.join(
          options.projectRoot,
          'node_modules/agent-browser/bin/agent-browser.js',
        ),
        '--config',
        config,
        '--session',
        options.session,
        '--headed',
        'false',
        '--args',
        recipe.browserArguments.join(','),
        '--no-webmcp',
        '--idle-timeout',
        '60s',
        '--allowed-domains',
        [
          ...new Set(
            [...allowedOrigins].map((value) => new URL(value).hostname),
          ),
        ].join(','),
        '--json',
        ...args,
      ],
      cwd: options.projectRoot,
      env: environment,
      transcript: path.join(options.directory, 'transcript.jsonl'),
      concealed,
      ...(stdin === undefined ? {} : { stdin }),
    });
  });

  const saveOutput = Effect.fnUntraced(function* (
    id: string,
    filename: string,
    args: readonly string[],
  ) {
    options.addArtifact(
      id,
      filename,
      `agent-browser ${args.join(' ')} output; credentials redacted`,
    );

    const output = yield* command(args);

    yield* fs.writeFileString(
      path.join(options.directory, filename),
      redactText(output, concealed),
      {
        flag: 'wx',
      },
    );

    return output;
  });

  const step = Effect.fnUntraced(function* (action: Step) {
    switch (action.kind) {
      case 'navigate':
        return yield* command([
          'open',
          new URL(action.path, options.url).toString(),
        ]);
      case 'click':
        return yield* command(['click', action.selector]);
      case 'click-role':
        return yield* command([
          'find',
          'role',
          action.role,
          'click',
          '--name',
          action.name,
        ]);
      case 'fill': {
        if (typeof action.value === 'string') {
          return yield* command(['fill', action.selector, action.value]);
        }

        const value = options.fillValues.get(action.value.env);

        if (value === undefined) {
          return yield* Effect.die(
            `Fill value for ${action.value.env} was not resolved`,
          );
        }

        // Batch input arrives on stdin, so the value stays out of process
        // arguments. Its echoed command output is concealed in the transcript.
        const output = yield* command(
          ['batch', '--bail'],
          JSON.stringify([['fill', action.selector, value]]),
        );

        return yield* decode(filledSchema, output).pipe(
          Effect.mapError(
            () =>
              new BrowserFailure({
                message: `agent-browser did not confirm the fill on ${action.selector}`,
              }),
          ),
          Effect.as(output),
        );
      }
      case 'press':
        return yield* command(['press', action.key]);
      case 'wait-text':
        return yield* command(['wait', '--text', action.text]);
      case 'wait-selector':
        return yield* command(['wait', action.selector]);
      case 'network-idle':
        return yield* command(['wait', '--load', 'networkidle']);
    }
  });

  const version = yield* command(['--version']);

  if (version.trim() !== `agent-browser ${producer.version}`) {
    return yield* new BrowserFailure({
      message: `Producer version mismatch: ${version.trim()}`,
    });
  }

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      yield* command(['close']);

      const waitClosed = Effect.gen(function* () {
        while (true) {
          const state = yield* decode(
            sessionSchema,
            yield* command(['session', 'info']),
          );

          if (!state.data.active) {
            yield* fs.writeFileString(
              path.join(options.directory, 'browser-cleanup.json'),
              json({ session: options.session, active: false }),
              { flag: 'wx' },
            );

            return;
          }

          yield* Effect.sleep('100 millis');
        }
      });

      yield* waitClosed.pipe(Effect.timeout('10 seconds'));
    }).pipe(Effect.orDie),
  );

  yield* command(['open', new URL(recipe.path, options.url).toString()]);

  yield* command([
    'set',
    'viewport',
    String(recipe.viewport.width),
    String(recipe.viewport.height),
    String(recipe.viewport.scale),
  ]);

  yield* command(['set', 'media', 'light', 'reduced-motion']);

  yield* Effect.forEach(recipe.ready, step, { discard: true });

  const observedEnvironment = yield* decode(
    environmentSchema,
    yield* saveOutput('environment', 'environment.json', [
      'eval',
      '-b',
      Buffer.from(
        '({locale: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, width: innerWidth, height: innerHeight, scale: devicePixelRatio})',
      ).toString('base64'),
    ]),
  );

  if (
    observedEnvironment.data.result.width !== recipe.viewport.width ||
    observedEnvironment.data.result.height !== recipe.viewport.height ||
    observedEnvironment.data.result.scale !== recipe.viewport.scale
  ) {
    return yield* new BrowserFailure({
      message: 'Browser viewport does not match the saved recipe',
    });
  }

  yield* command(['network', 'requests', '--clear']);

  const startedAt = DateTime.formatIso(yield* DateTime.now);

  yield* command(['network', 'har', 'start', '--content', 'none']);

  yield* Effect.forEach(recipe.steps, step, { discard: true });

  yield* saveOutput('snapshot', 'snapshot.json', ['snapshot']);

  let text: Observations['text'];

  if (recipe.check?.kind === 'text') {
    const selector = recipe.check.selector;
    const count = yield* decode(
      response(
        Schema.Struct({
          count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
        }),
      ),
      yield* saveOutput('text-count', 'text-count.json', [
        'get',
        'count',
        selector,
      ]),
    );
    let value: string | null = null;

    if (count.data.count === 1) {
      const observed = yield* decode(
        response(Schema.Struct({ text: Schema.String })),
        yield* saveOutput('text', 'text.json', ['get', 'text', selector]),
      );
      value = observed.data.text;

      if (redact(value) !== value || conceal(value, concealed) !== value) {
        return yield* new BrowserFailure({
          message:
            'Text observation contains credentials. Exact-text evaluation and screenshot capture are unavailable.',
        });
      }
    }

    text = { selector, count: count.data.count, value };
  }

  options.addArtifact(
    'screenshot',
    'screenshot.png',
    'Browser screenshot after the configured actions',
  );
  yield* command([
    'screenshot',
    path.join(options.directory, 'screenshot.png'),
  ]);

  const requests = yield* decode(
    requestsSchema,
    yield* saveOutput('request-log', 'requests.json', ['network', 'requests']),
  );

  const errors = yield* decode(
    errorsSchema,
    yield* saveOutput('errors', 'errors.json', ['errors']),
  );

  const messages = yield* decode(
    consoleSchema,
    yield* saveOutput('console', 'console.json', ['console']),
  );

  options.addArtifact(
    'requests',
    'requests.har',
    'Browser HAR for the recorded window; credentials redacted',
  );

  yield* command([
    'network',
    'har',
    'stop',
    path.join(options.directory, 'requests.har'),
  ]);

  const finishedAt = DateTime.formatIso(yield* DateTime.now);

  const harFile = path.join(options.directory, 'requests.har');
  const harText = yield* fs.readFileString(harFile);
  yield* fs.writeFileString(harFile, redactText(harText, concealed));
  const har = yield* decode(harSchema, harText);

  if (
    har.log.entries.some(
      (entry) => !allowedOrigins.has(entry.request.url.origin),
    ) ||
    requests.data.requests.some(
      (request) => !allowedOrigins.has(request.url.origin),
    )
  ) {
    return yield* new BrowserFailure({
      message:
        'Capture includes requests outside the application and configured allowedOrigins',
    });
  }

  const harLedger = har.log.entries
    .map(
      (entry) =>
        `${entry.request.method} ${entry.request.url.href} ${entry.response.status}`,
    )
    .sort();

  const requestLedger = requests.data.requests
    .map((request) => `${request.method} ${request.url.href} ${request.status}`)
    .sort();

  if (
    json(harLedger) !== json(requestLedger) ||
    new Set(requests.data.requests.map((request) => request.requestId)).size !==
      requests.data.requests.length
  ) {
    return yield* new BrowserFailure({
      message: 'HAR and request log disagree; capture completeness is unknown',
    });
  }

  const observations = yield* Schema.decodeUnknownEffect(observationsSchema)({
    schemaVersion: 2,
    requests: har.log.entries.map((entry) => ({
      method: entry.request.method,
      origin:
        entry.request.url.origin === origin
          ? 'application'
          : entry.request.url.origin,
      path: entry.request.url.pathname,
      status: entry.response.status,
      startedAt: DateTime.formatIso(entry.startedDateTime),
    })),
    browserErrors: [
      ...errors.data.errors.map((error) => error.text),
      ...messages.data.messages
        .filter((message) => message.type === 'error')
        .map((message) => message.text),
    ],
    window: { startedAt, finishedAt },
    ...(text === undefined ? {} : { text }),
  });

  options.addArtifact(
    'observations',
    'observations.json',
    'Normalized browser measurements; no imported pass/fail claims',
  );

  yield* fs.writeFileString(
    path.join(options.directory, 'observations.json'),
    redactText(json(observations), concealed),
    { flag: 'wx' },
  );

  return {
    browser: `${har.log.browser.name} ${har.log.browser.version}`,
    platform: `${process.platform}/${process.arch}`,
    bun: Bun.version,
    viewport: recipe.viewport,
    colorScheme: 'light',
    locale: observedEnvironment.data.result.locale,
    timezone: observedEnvironment.data.result.timezone,
    inputsHash: options.inputsHash,
    dependenciesHash: options.dependenciesHash,
  } satisfies Conditions;
});
