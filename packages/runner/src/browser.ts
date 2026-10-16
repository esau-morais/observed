import {
  evidenceKinds,
  json,
  observationsSchema,
  type CaptureArtifact,
  type Conditions,
  type EvidenceKind,
  type Recipe,
} from '@observed/judge';
import { DateTime, Effect, FileSystem, Option, Schema } from 'effect';
import path from 'node:path';
import type { Browser, Page } from 'playwright';
import { collectAccessibility } from './collectors/accessibility';
import { BrowserFailure, EvidenceUnavailable, browserCall } from './collectors/define';
import { browserErrorsValue, timelineValue, type JourneyLog } from './collectors/journey-log';
import { collectText } from './collectors/text';
import { watchNetwork } from './network';
import { conceal, redact, redactText } from './redact';
import { runStep, stepTarget, stepTimeoutMs } from './steps';

export type NewArtifact = Omit<CaptureArtifact, 'sha256'>;

export type PendingEvidence =
  | {
      kind: string;
      schemaVersion: number;
      status: 'recorded';
      path: string;
      conditions: Record<string, string | number | boolean | null>;
    }
  | { kind: string; schemaVersion: number; status: 'unavailable'; reason: string };

const settleQuietMs = 100;
const settleTimeoutMs = 2_000;

const notCollected: Partial<Record<EvidenceKind, string>> = {
  coverage:
    'This runner does not collect coverage; it returns with change scope, which is the part that reads it',
};

const harSchema = Schema.Struct({
  log: Schema.Struct({
    browser: Schema.optionalKey(Schema.Struct({ name: Schema.String, version: Schema.String })),
    entries: Schema.Array(
      Schema.Struct({
        startedDateTime: Schema.String,
        request: Schema.Struct({ method: Schema.String, url: Schema.String }),
        response: Schema.Struct({ status: Schema.Int }),
      }),
    ),
  }),
});

const environmentSchema = Schema.Struct({
  locale: Schema.NonEmptyString,
  timezone: Schema.NonEmptyString,
  width: Schema.Int,
  height: Schema.Int,
  scale: Schema.Number,
});

const ledger = (entries: readonly { method: string; url: string; status: number }[]) =>
  entries.map((entry) => `${entry.method} ${entry.url} ${entry.status}`).sort();

export const captureBrowser = Effect.fn('captureBrowser')(function* (options: {
  browser: Browser;
  directory: string;
  url: string;
  recipe: Recipe;
  fillValues: ReadonlyMap<string, string>;
  addArtifact: (artifact: NewArtifact) => void;
  addEvidence: (entry: PendingEvidence) => void;
  inputsHash: string;
  dependenciesHash: string | null;
}) {
  const fs = yield* FileSystem.FileSystem;
  const { recipe, directory } = options;
  const concealed = [...options.fillValues.values()];
  const origin = new URL(options.url).origin;
  const allowed = new Set([origin, ...(recipe.allowedOrigins ?? [])]);
  const log: JourneyLog = { steps: [], errors: [] };
  const blocked = new Set<string>();

  const saveText = Effect.fnUntraced(function* ({
    text,
    ...artifact
  }: NewArtifact & { text: string }) {
    options.addArtifact({
      ...artifact,
      description: `${artifact.description}; credentials redacted`,
    });
    yield* fs.makeDirectory(path.dirname(path.join(directory, artifact.path)), { recursive: true });
    yield* fs.writeFileString(path.join(directory, artifact.path), redactText(text, concealed), {
      flag: 'wx',
    });
  });

  const context = yield* Effect.acquireRelease(
    browserCall('Opening a browser context', () =>
      options.browser.newContext({
        viewport: { width: recipe.viewport.width, height: recipe.viewport.height },
        deviceScaleFactor: recipe.viewport.scale,
        locale: 'en-US',
        timezoneId: 'UTC',
        colorScheme: 'light',
        reducedMotion: 'reduce',
        serviceWorkers: 'block',
      }),
    ),
    (opened) =>
      Effect.promise(() => opened.close()).pipe(
        Effect.timeout('10 seconds'),
        Effect.as(true),
        Effect.orElseSucceed(() => false),
        Effect.flatMap((contextClosed) =>
          fs.writeFileString(
            path.join(directory, 'browser-cleanup.json'),
            json({ contextClosed }),
            { flag: 'wx' },
          ),
        ),
        Effect.orDie,
      ),
  );
  options.addArtifact({
    id: 'browser-cleanup',
    path: 'browser-cleanup.json',
    description: 'Owned browser context shutdown',
  });
  context.setDefaultTimeout(stepTimeoutMs);

  yield* browserCall('Limiting requests to allowed origins', () =>
    context.route(
      (url) => /^https?:$/.test(url.protocol) && !allowed.has(url.origin),
      (route) => {
        blocked.add(new URL(route.request().url()).origin);

        return route.abort('blockedbyclient');
      },
    ),
  );

  const network = watchNetwork(context);
  const page: Page = yield* browserCall('Opening a page', () => context.newPage());
  const at = () => new Date().toISOString();

  page.on('pageerror', (error) => {
    log.errors.push({ source: 'page', text: String(error), at: at() });
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      log.errors.push({ source: 'console', text: message.text(), at: at() });
    }
  });

  const run = (phase: 'Ready step' | 'Step', step: Recipe['steps'][number], index: number) =>
    browserCall(
      `${phase} ${index + 1} (${[step.kind, stepTarget(step)].filter((part) => part !== null).join(' ')})`,
      () =>
        runStep({
          page,
          step,
          url: options.url,
          fillValues: options.fillValues,
          idle: network.idle,
        }),
      'application',
    );

  yield* browserCall(
    'Opening the journey path',
    () => page.goto(new URL(recipe.path, options.url).toString()),
    'application',
  );
  yield* Effect.forEach(recipe.ready, (step, index) => run('Ready step', step, index), {
    discard: true,
  });

  const environmentText = yield* browserCall('Reading the page environment', () =>
    page.evaluate<string>(
      'JSON.stringify({ locale: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, width: innerWidth, height: innerHeight, scale: devicePixelRatio })',
    ),
  );
  yield* saveText({
    id: 'environment',
    path: 'environment.json',
    description: 'Page locale, time zone and viewport',
    text: environmentText,
  });
  const environment = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(environmentSchema))(
    environmentText,
  );

  if (
    environment.width !== recipe.viewport.width ||
    environment.height !== recipe.viewport.height ||
    environment.scale !== recipe.viewport.scale
  ) {
    return yield* new BrowserFailure({
      category: 'producer',
      message: 'Browser viewport does not match the saved recipe',
    });
  }

  const masks = (recipe.mask ?? []).map((selector) => page.locator(selector));
  const shots: { file: string; after: string; settled: boolean }[] = [];

  const shoot = Effect.fnUntraced(function* (file: string, after: string) {
    const settled = yield* browserCall('Settling the page', async () => {
      const quiet = await network.idle({ quietMs: settleQuietMs, timeoutMs: settleTimeoutMs });
      await page.evaluate(
        'document.fonts.ready.then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))',
      );

      return quiet;
    });

    yield* fs.makeDirectory(path.dirname(path.join(directory, file)), { recursive: true });
    yield* browserCall('Taking a screenshot', () =>
      page.screenshot({
        path: path.join(directory, file),
        animations: 'disabled',
        caret: 'hide',
        scale: 'css',
        mask: masks,
      }),
    );
    shots.push({ file, after, settled });
    options.addArtifact({
      id: file === 'screenshot.png' ? 'screenshot' : `shot-${path.basename(file, '.png')}`,
      path: file,
      description: `Screenshot after ${after}`,
    });
  });

  const harFile = path.join(directory, 'requests.har');
  yield* browserCall('Waiting for readiness requests', () =>
    network.idle({ quietMs: settleQuietMs, timeoutMs: settleTimeoutMs }),
  );
  yield* browserCall('Starting the HAR', () =>
    context.tracing.startHar(harFile, { content: 'omit' }),
  );
  const startedAt = DateTime.formatIso(yield* DateTime.now);
  const windowStart = Date.parse(startedAt);
  const shotName = (index: number) =>
    index === recipe.steps.length
      ? 'screenshot.png'
      : `shots/${String(index).padStart(2, '0')}.png`;

  yield* shoot(shotName(0), 'ready');

  const journey = Effect.gen(function* () {
    for (const [index, step] of recipe.steps.entries()) {
      const stepStarted = at();
      const exit = yield* Effect.exit(run('Step', step, index));

      log.steps.push({
        outcome: exit._tag === 'Success' ? 'completed' : 'failed',
        startedAt: stepStarted,
        finishedAt: at(),
      });

      yield* exit;
      yield* shoot(shotName(index + 1), `step ${index + 1}`);
    }
  });

  const pendingKinds = new Set(recipe.collectors.map((collector) => collector.kind));

  const record = Effect.fnUntraced(function* <E>(
    kind: EvidenceKind,
    collected: Effect.Effect<unknown, EvidenceUnavailable | E>,
    conditions: Record<string, string | number | boolean | null> = {},
  ) {
    if (!pendingKinds.delete(kind)) {
      return;
    }

    const definition = evidenceKinds[kind];
    const result = yield* collected.pipe(
      Effect.map((value) => ({ kind: 'recorded', value }) as const),
      Effect.catchIf(
        (error) => error instanceof EvidenceUnavailable,
        ({ reason }) => Effect.succeed({ kind: 'unavailable', reason } as const),
      ),
    );
    const file =
      result.kind === 'recorded'
        ? yield* Schema.encodeUnknownEffect(definition.file)({
            kind,
            schemaVersion: definition.schemaVersion,
            value: result.value,
          }).pipe(Effect.option)
        : Option.none();

    if (Option.isNone(file)) {
      options.addEvidence({
        kind,
        schemaVersion: definition.schemaVersion,
        status: 'unavailable',
        reason: redactText(
          result.kind === 'unavailable'
            ? result.reason
            : `The collector's value does not match ${kind} schema version ${definition.schemaVersion}`,
          concealed,
        ).trim(),
      });

      return;
    }

    const filename = `evidence/${kind}.json`;
    yield* saveText({
      id: `evidence-${kind}`,
      path: filename,
      description: `${definition.title} evidence, schema version ${definition.schemaVersion}`,
      text: json(file.value),
    });
    options.addEvidence({
      kind,
      schemaVersion: definition.schemaVersion,
      status: 'recorded',
      path: filename,
      conditions,
    });
  });

  const journeyLogEvidence = (journeyLog: JourneyLog, tree: string | null) =>
    Effect.gen(function* () {
      yield* record('timeline', Effect.succeed(timelineValue(recipe.steps, journeyLog, tree)));
      yield* record(
        'browser-errors',
        Effect.succeed(browserErrorsValue(recipe.steps, journeyLog)),
        {
          errorReads: 'browser-events',
        },
      );
    });

  // A blocked request usually breaks a step first, so the failure names it.
  yield* journey.pipe(
    Effect.tapError(() => journeyLogEvidence({ steps: log.steps, errors: [...log.errors] }, null)),
    Effect.mapError((error) =>
      blocked.size === 0 || error._tag !== 'BrowserFailure'
        ? error
        : new BrowserFailure({
            category: error.category,
            message: `${error.message}. The app also requested ${[...blocked].sort().join(', ')}, which allowedOrigins does not list`,
          }),
    ),
  );

  const tree = yield* browserCall('Reading the accessibility tree', () =>
    page.locator('body').ariaSnapshot(),
  );
  yield* saveText({
    id: 'snapshot',
    path: 'snapshot.yml',
    description: 'Final accessibility tree from Playwright',
    text: tree,
  });
  const beforeCollectors: JourneyLog = { steps: log.steps, errors: [...log.errors] };
  yield* saveText({
    id: 'errors',
    path: 'errors.json',
    description: 'Page errors and console errors as the browser reported them',
    text: json(beforeCollectors.errors),
  });
  yield* journeyLogEvidence(beforeCollectors, tree);

  for (const collector of recipe.collectors) {
    switch (collector.kind) {
      case 'text':
        yield* record(
          'text',
          collectText({
            page,
            selectors: collector.selectors,
            hasCredentials: (value) =>
              redact(value) !== value || conceal(value, concealed) !== value,
            save: (index, raw) =>
              saveText({
                id: `text-${index}`,
                path: `text-${index}.json`,
                description: 'Element text from Playwright',
                text: json(raw),
              }),
          }),
        );
        break;
      case 'accessibility':
        yield* record(
          'accessibility',
          collectAccessibility({
            page,
            save: (raw) =>
              saveText({
                id: 'a11y',
                path: 'a11y.json',
                description: 'axe-core result',
                text: json(raw),
              }),
          }),
        );
        break;
      default:
        yield* record(
          collector.kind,
          Effect.fail(
            new EvidenceUnavailable({
              reason:
                notCollected[collector.kind] ??
                `This runner does not collect ${collector.kind} evidence yet`,
            }),
          ),
        );
    }
  }

  yield* browserCall('Stopping the HAR', () => context.tracing.stopHar());
  const finishedAt = DateTime.formatIso(yield* DateTime.now);
  options.addArtifact({
    id: 'requests',
    path: 'requests.har',
    description: 'Browser HAR for the recorded window; credentials redacted',
  });
  const harText = yield* fs.readFileString(harFile);
  yield* fs.writeFileString(harFile, redactText(harText, concealed));
  const har = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(harSchema))(harText);

  if (blocked.size > 0) {
    return yield* new BrowserFailure({
      category: 'application',
      message: `The app requested ${[...blocked].sort().join(', ')}, which allowedOrigins does not list`,
    });
  }

  const inWindow = network.requests.filter((request) => request.startedAt >= windowStart);
  const windowed = inWindow.flatMap((request) =>
    request.status === null ? [] : [{ ...request, status: request.status }],
  );

  if (
    windowed.length !== inWindow.length ||
    json(
      ledger(har.log.entries.map((entry) => ({ ...entry.request, status: entry.response.status }))),
    ) !==
      json(
        ledger(
          windowed.map((request) => ({
            method: request.method,
            url: request.url.href,
            status: request.status,
          })),
        ),
      )
  ) {
    return yield* new BrowserFailure({
      category: 'producer',
      message: 'HAR and request log disagree; capture completeness is unknown',
    });
  }

  yield* saveText({
    id: 'request-log',
    path: 'request-log.json',
    description: 'Requests Playwright reported during the recorded window',
    text: json(
      windowed.map((request) => ({
        ...request,
        url: request.url.href,
        startedAt: new Date(request.startedAt).toISOString(),
      })),
    ),
  });

  const observations = yield* Schema.decodeUnknownEffect(observationsSchema)({
    schemaVersion: 3,
    requests: windowed.map((request) => ({
      method: request.method,
      origin: request.url.origin === origin ? 'application' : request.url.origin,
      path: request.url.pathname,
      status: request.status,
      startedAt: new Date(request.startedAt).toISOString(),
    })),
    browserErrors: beforeCollectors.errors.map((error) => error.text),
    window: { startedAt, finishedAt },
  });

  yield* saveText({
    id: 'observations',
    path: 'observations.json',
    description: 'Normalized browser measurements; no imported pass/fail claims',
    text: json(observations),
  });
  yield* saveText({
    id: 'shots',
    path: 'shots.json',
    description: 'When each screenshot was taken and whether the page settled',
    text: json(shots),
  });

  return {
    browser: `chromium ${options.browser.version()}`,
    platform: `${process.platform}/${process.arch}`,
    bun: Bun.version,
    viewport: recipe.viewport,
    colorScheme: 'light',
    locale: environment.locale,
    timezone: environment.timezone,
    inputsHash: options.inputsHash,
    dependenciesHash: options.dependenciesHash,
  } satisfies Conditions;
});
