import { DateTime, Effect, FileSystem, Option, Schema } from 'effect';
import path from 'node:path';
import { agentBrowserPath } from '../installation';
import { observationsSchema, type Conditions } from './model';
import { processOutput } from './process';
import { json } from '../encoding';
import { redactText } from '../redact';
import type { Recipe, Step } from './recipe';
import { collectorFor } from './collectors';
import {
  BrowserFailure,
  type CollectorContext,
  type CollectorError,
  type CollectorServices,
} from './collectors/define';
import { evidenceKinds, type EvidenceKind } from '../evidence-kinds';

export { BrowserFailure };

export const producer = { name: 'agent-browser', version: '0.38.1' } as const;

export type PendingEvidence =
  | {
      kind: string;
      schemaVersion: number;
      status: 'recorded';
      path: string;
      conditions: Record<string, string | number | boolean | null>;
    }
  | {
      kind: string;
      schemaVersion: number;
      status: 'unavailable';
      reason: string;
    };

const response = <S extends Schema.Constraint>(data: S) =>
  Schema.Struct({
    success: Schema.Literal(true),
    data,
  });

const sessionSchema = response(Schema.Struct({ active: Schema.Boolean }));

const filledSchema = Schema.Tuple([
  Schema.Struct({ success: Schema.Literal(true) }),
]);

// agent-browser 0.38.1 omits the status of a request answered by a redirect,
// and the next request in the chain reuses its requestId. Its HAR records the
// same request with status 0.
const requestSchema = Schema.Struct({
  requestId: Schema.NonEmptyString,
  url: Schema.URLFromString,
  method: Schema.NonEmptyString,
  status: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  ),
});

// Returns null when the log is inconsistent: a request without a status must
// be followed by its redirect under the same requestId, and only the last
// request in a chain may carry a status.
export function requestLedger(
  requests: readonly (typeof requestSchema.Type)[],
): string[] | null {
  const chains = new Map<string, (typeof requestSchema.Type)[]>();

  for (const request of requests) {
    chains.set(request.requestId, [
      ...(chains.get(request.requestId) ?? []),
      request,
    ]);
  }

  for (const chain of chains.values()) {
    if (
      chain.some(
        (request, index) =>
          (request.status === undefined) !== index < chain.length - 1,
      )
    ) {
      return null;
    }
  }

  return requests
    .map(
      (request) =>
        `${request.method} ${request.url.href} ${request.status ?? 0}`,
    )
    .sort();
}

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
  addEvidence: (entry: PendingEvidence) => void;
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

  const sessionCommand = (session: string, launch: readonly string[]) =>
    Effect.fnUntraced(function* (args: readonly string[], stdin?: string) {
      return yield* processOutput({
        command: process.execPath,
        args: [
          agentBrowserPath(options.projectRoot),
          '--config',
          config,
          '--session',
          session,
          ...launch,
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

  const command = sessionCommand(options.session, []);

  type Command = typeof command;

  const outputSaver = (run: Command) =>
    Effect.fnUntraced(function* (
      id: string,
      filename: string,
      args: readonly string[],
    ) {
      options.addArtifact(
        id,
        filename,
        `agent-browser ${args.join(' ')} output; credentials redacted`,
      );

      const output = yield* run(args);

      yield* fs.writeFileString(
        path.join(options.directory, filename),
        redactText(output, concealed),
        {
          flag: 'wx',
        },
      );

      return output;
    });

  const saveOutput = outputSaver(command);

  const stepRunner = (run: Command) =>
    Effect.fnUntraced(function* (action: Step) {
      switch (action.kind) {
        case 'navigate':
          return yield* run([
            'open',
            new URL(action.path, options.url).toString(),
          ]);
        case 'click':
          return yield* run(['click', action.selector]);
        case 'click-role':
          return yield* run([
            'find',
            'role',
            action.role,
            'click',
            '--name',
            action.name,
          ]);
        case 'fill': {
          if (typeof action.value === 'string') {
            return yield* run(['fill', action.selector, action.value]);
          }

          const value = options.fillValues.get(action.value.env);

          if (value === undefined) {
            return yield* Effect.die(
              `Fill value for ${action.value.env} was not resolved`,
            );
          }

          // Batch input arrives on stdin, so the value stays out of process
          // arguments. Its echoed command output is concealed in the transcript.
          const output = yield* run(
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
          return yield* run(['press', action.key]);
        case 'wait-text':
          return yield* run(['wait', '--text', action.text]);
        case 'wait-selector':
          return yield* run(['wait', action.selector]);
        case 'network-idle':
          return yield* run(['wait', '--load', 'networkidle']);
      }
    });

  const step = stepRunner(command);

  const version = yield* command(['--version']);

  if (version.trim() !== `agent-browser ${producer.version}`) {
    return yield* new BrowserFailure({
      message: `Producer version mismatch: ${version.trim()}`,
    });
  }

  const closeOnExit = (run: Command, session: string, cleanup: string) =>
    Effect.addFinalizer(() =>
      Effect.gen(function* () {
        yield* run(['close']);

        const waitClosed = Effect.gen(function* () {
          while (true) {
            const state = yield* decode(
              sessionSchema,
              yield* run(['session', 'info']),
            );

            if (!state.data.active) {
              yield* fs.writeFileString(
                path.join(options.directory, cleanup),
                json({ session, active: false }),
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

  yield* closeOnExit(command, options.session, 'browser-cleanup.json');

  const context: CollectorContext = {
    directory: options.directory,
    url: options.url,
    recipe,
    concealed,
    browser: command,
    saveOutput,
    addArtifact: options.addArtifact,
  };

  const collectEvidence = Effect.fnUntraced(function* (
    kind: EvidenceKind,
    collected: Effect.Effect<unknown, CollectorError, CollectorServices>,
  ) {
    const definition = evidenceKinds[kind];
    const filename = `evidence/${definition.kind}.json`;
    const value = yield* collected.pipe(
      Effect.map((result) => ({ kind: 'recorded', result }) as const),
      Effect.catchTag('EvidenceUnavailable', ({ reason }) =>
        Effect.succeed({ kind: 'unavailable', reason } as const),
      ),
    );

    if (value.kind === 'unavailable') {
      options.addEvidence({
        kind: definition.kind,
        schemaVersion: definition.schemaVersion,
        status: 'unavailable',
        reason: redactText(value.reason, concealed),
      });

      return;
    }

    const file = yield* Schema.encodeUnknownEffect(definition.file)({
      kind: definition.kind,
      schemaVersion: definition.schemaVersion,
      value: value.result,
    }).pipe(Effect.option);

    if (Option.isNone(file)) {
      options.addEvidence({
        kind: definition.kind,
        schemaVersion: definition.schemaVersion,
        status: 'unavailable',
        reason: `The collector's value does not match ${definition.kind} schema version ${definition.schemaVersion}`,
      });

      return;
    }

    yield* fs.makeDirectory(path.join(options.directory, 'evidence'), {
      recursive: true,
    });
    options.addArtifact(
      `evidence-${definition.kind}`,
      filename,
      `${definition.title} evidence, schema version ${definition.schemaVersion}; credentials redacted`,
    );
    yield* fs.writeFileString(
      path.join(options.directory, filename),
      redactText(json(file.value), concealed),
      { flag: 'wx' },
    );
    options.addEvidence({
      kind: definition.kind,
      schemaVersion: definition.schemaVersion,
      status: 'recorded',
      path: filename,
      conditions: {},
    });
  });

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

  for (const config of recipe.collectors) {
    const collector = collectorFor(config);

    if (collector.phase === 'journey') {
      yield* collectEvidence(config.kind, collector.collect(config, context));
    }
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

  const requestEntries = requestLedger(requests.data.requests);

  if (requestEntries === null || json(harLedger) !== json(requestEntries)) {
    return yield* new BrowserFailure({
      message: 'HAR and request log disagree; capture completeness is unknown',
    });
  }

  const observations = yield* Schema.decodeUnknownEffect(observationsSchema)({
    schemaVersion: 3,
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

  for (const [index, config] of recipe.collectors.entries()) {
    const collector = collectorFor(config);

    if (collector.phase === 'separate-session') {
      const session = `${options.session}-${index}`;
      const run = sessionCommand(session, collector.launchArguments ?? []);
      const cleanup = `browser-cleanup-${config.kind}.json`;

      options.addArtifact(
        `browser-cleanup-${config.kind}`,
        cleanup,
        `Owned browser shutdown for the ${config.kind} collector`,
      );

      yield* Effect.gen(function* () {
        yield* closeOnExit(run, session, cleanup);
        const runStep = stepRunner(run);

        yield* collectEvidence(
          config.kind,
          collector.collect(config, {
            ...context,
            browser: run,
            saveOutput: outputSaver(run),
            runSteps: (steps) =>
              Effect.forEach(steps, runStep, { discard: true }),
          }),
        );
      }).pipe(Effect.scoped);
    }
  }

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
