import { DateTime, Effect, FileSystem, Schema } from 'effect';
import path from 'node:path';
import { observationsSchema, type Conditions } from './model';
import { processOutput } from './process';
import { fixtureHash, json, producer, recipe, sha256 } from './recipe';

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
      name: Schema.Literal('agent-browser'),
      version: Schema.Literal('0.38.1'),
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
}) {
  const fs = yield* FileSystem.FileSystem;
  const temporary = yield* fs.makeTempDirectoryScoped({ prefix: 'obs-' });
  const config = path.join(options.directory, 'browser-config.json');

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

  const command = Effect.fnUntraced(function* (args: readonly string[]) {
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
        '127.0.0.1',
        '--json',
        ...args,
      ],
      cwd: options.projectRoot,
      env: environment,
      transcript: path.join(options.directory, 'transcript.jsonl'),
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
      `Original agent-browser ${args.join(' ')} output`,
    );

    const output = yield* command(args);

    yield* fs.writeFileString(path.join(options.directory, filename), output, {
      flag: 'wx',
    });

    return output;
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

  yield* command(['open', options.url]);

  yield* command([
    'set',
    'viewport',
    String(recipe.viewport.width),
    String(recipe.viewport.height),
    String(recipe.viewport.scale),
  ]);

  yield* command(['set', 'media', 'light', 'reduced-motion']);

  yield* command(['wait', '--text', recipe.readyText]);

  yield* command(['wait', '--load', 'networkidle']);

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

  yield* command([
    'find',
    'role',
    recipe.action.role,
    'click',
    '--name',
    recipe.action.name,
  ]);

  yield* command(['wait', '--text', recipe.completionText]);

  yield* command(['wait', '--load', 'networkidle']);

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
    'Original browser HAR for the measured action',
  );

  yield* command([
    'network',
    'har',
    'stop',
    path.join(options.directory, 'requests.har'),
  ]);

  const finishedAt = DateTime.formatIso(yield* DateTime.now);

  const har = yield* decode(
    harSchema,
    yield* fs.readFileString(path.join(options.directory, 'requests.har')),
  );

  const origin = new URL(options.url).origin;

  if (
    har.log.entries.some((entry) => entry.request.url.origin !== origin) ||
    requests.data.requests.some((request) => request.url.origin !== origin)
  ) {
    return yield* new BrowserFailure({
      message:
        'Capture includes requests outside the controlled application origin',
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

  options.addArtifact(
    'screenshot',
    'screenshot.png',
    'Browser screenshot after the load action',
  );

  yield* command([
    'screenshot',
    path.join(options.directory, 'screenshot.png'),
  ]);

  yield* saveOutput('snapshot', 'snapshot.json', ['snapshot']);

  const observations = yield* Schema.decodeUnknownEffect(observationsSchema)({
    schemaVersion: 1,
    requests: har.log.entries.map((entry) => ({
      method: entry.request.method,
      path: `${entry.request.url.pathname}${entry.request.url.search}`,
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
  });

  options.addArtifact(
    'observations',
    'observations.json',
    'Normalized browser measurements; no imported pass/fail claims',
  );

  yield* fs.writeFileString(
    path.join(options.directory, 'observations.json'),
    json(observations),
    { flag: 'wx' },
  );

  const lockfile = yield* fs.readFile(
    path.join(options.directory, 'source/bun.lock'),
  );

  return {
    browser: `${har.log.browser.name} ${har.log.browser.version}`,
    platform: `${process.platform}/${process.arch}`,
    bun: Bun.version,
    viewport: recipe.viewport,
    colorScheme: 'light',
    locale: observedEnvironment.data.result.locale,
    timezone: observedEnvironment.data.result.timezone,
    fixtureHash,
    lockfileHash: sha256(lockfile),
  } satisfies Conditions;
});
