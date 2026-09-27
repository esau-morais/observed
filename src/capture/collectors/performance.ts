import { DateTime, Effect, FileSystem, Schema } from 'effect';
import path from 'node:path';
import type { CollectorConfig } from '../../evidence-kinds';
import type { Recipe } from '../recipe';
import {
  performanceDefaults,
  performanceValueSchema,
  type PerformanceInspection,
  type PerformanceSample,
} from '../../evidence-kinds/performance';
import { conceal, redactText } from '../../redact';
import {
  EvidenceUnavailable,
  type Collector,
  type CollectorError,
  type CollectorServices,
  type SeparateSessionContext,
} from './define';

function describe(error: CollectorError | Error): string {
  return error instanceof EvidenceUnavailable ? error.reason : error.message;
}

// Registered with --init-script so the observers exist before page scripts
// run. agent-browser's `vitals` reloads the page before reading, so it cannot
// measure a journey's interactions. CLS uses session windows and INP groups
// event timing entries by interaction, as web-vitals defines them. A metric
// whose observer cannot register stays null rather than reading as zero.
const observerScript = `(() => {
  if (window.__observedPerformance !== undefined) return;
  const state = { lcp: null, fcp: null, cls: null, events: false, shift: { value: 0, first: 0, last: 0 }, interactions: new Map() };
  window.__observedPerformance = state;
  const observe = (type, callback, options) => {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach(callback)).observe({ type, buffered: true, ...options });
      return true;
    } catch {
      return false;
    }
  };
  observe('largest-contentful-paint', (entry) => { state.lcp = entry.startTime; });
  observe('paint', (entry) => { if (entry.name === 'first-contentful-paint') state.fcp = entry.startTime; });
  const shifts = observe('layout-shift', (entry) => {
    if (entry.hadRecentInput) return;
    const shift = state.shift;
    if (shift.value > 0 && entry.startTime - shift.last < 1000 && entry.startTime - shift.first < 5000) {
      shift.value += entry.value;
      shift.last = entry.startTime;
    } else {
      shift.value = entry.value;
      shift.first = entry.startTime;
      shift.last = entry.startTime;
    }
    state.cls = Math.max(state.cls ?? 0, shift.value);
  });
  if (shifts && state.cls === null) state.cls = 0;
  const interaction = (entry) => {
    if (!entry.interactionId) return;
    state.interactions.set(entry.interactionId, Math.max(state.interactions.get(entry.interactionId) ?? 0, entry.duration));
  };
  state.events = observe('event', interaction, { durationThreshold: 16 }) && observe('first-input', interaction);
})();
`;

// INP is the 98th percentile interaction: the worst one, skipping one per 50.
// TTFB counts from navigation start, as web-vitals does; agent-browser's own
// ttfb field starts at requestStart.
const readScript = `JSON.stringify((() => {
  const state = window.__observedPerformance;
  const nav = performance.getEntriesByType('navigation')[0];
  const positive = (value) => (value > 0 ? value : null);
  const latencies = state === undefined ? [] : [...state.interactions.values()].sort((a, b) => b - a);
  return {
    observer: state !== undefined,
    events: state?.events ?? false,
    timeOrigin: performance.timeOrigin,
    document: location.pathname + location.hash,
    viewport: { width: innerWidth, height: innerHeight, scale: devicePixelRatio },
    interactions: latencies.length,
    lcp: state?.lcp ?? null,
    fcp: state?.fcp ?? null,
    cls: state?.cls ?? null,
    inp: latencies.length === 0 || !state.events ? null : latencies[Math.min(latencies.length - 1, Math.floor(latencies.length / 50))],
    ttfb: nav === undefined ? null : positive(nav.responseStart - (nav.activationStart ?? 0)),
    domContentLoaded: nav === undefined ? null : positive(nav.domContentLoadedEventEnd),
    load: nav === undefined ? null : positive(nav.loadEventEnd),
  };
})())`;

const metric = Schema.NullOr(
  Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
);

export const readingSchema = Schema.fromJsonString(
  Schema.Struct({
    success: Schema.Literal(true),
    data: Schema.Struct({
      result: Schema.fromJsonString(
        Schema.Struct({
          observer: Schema.Boolean,
          events: Schema.Boolean,
          timeOrigin: Schema.Number,
          document: Schema.String,
          viewport: Schema.Struct({
            width: Schema.Number,
            height: Schema.Number,
            scale: Schema.Number,
          }),
          interactions: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
          lcp: metric,
          fcp: metric,
          cls: metric,
          inp: metric,
          ttfb: metric,
          domContentLoaded: metric,
          load: metric,
        }),
      ),
    }),
  }),
);

const originSchema = Schema.fromJsonString(
  Schema.Struct({
    success: Schema.Literal(true),
    data: Schema.Struct({ result: Schema.Number.check(Schema.isFinite()) }),
  }),
);

type Reading = (typeof readingSchema.Type)['data']['result'];

export type Converted =
  | { kind: 'sample'; sample: PerformanceSample }
  | { kind: 'rejected'; reason: string };

export function toSample(
  reading: Reading,
  run: {
    run: number;
    warmup: boolean;
    startedAt: string;
    finishedAt: string;
    viewport: Recipe['viewport'];
    previousOrigin: number | null;
  },
): Converted {
  const rejected = (reason: string) => ({ kind: 'rejected', reason }) as const;

  if (!reading.observer) {
    return rejected(
      `The timing observer did not run on the page in run ${run.run}`,
    );
  }

  // A path that differs only by its fragment navigates within the same
  // document, so the run would read the previous run's timings again.
  if (reading.timeOrigin === run.previousOrigin) {
    return rejected(
      `Run ${run.run} did not load a new page, so its timings repeat the previous run`,
    );
  }

  if (
    reading.viewport.width !== run.viewport.width ||
    reading.viewport.height !== run.viewport.height ||
    reading.viewport.scale !== run.viewport.scale
  ) {
    return rejected(
      `Browser viewport in run ${run.run} does not match the saved recipe`,
    );
  }

  return {
    kind: 'sample',
    sample: {
      run: run.run,
      warmup: run.warmup,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      document: reading.document === '' ? '/' : reading.document,
      interactions: reading.events ? reading.interactions : null,
      metrics: {
        lcp: reading.lcp,
        fcp: reading.fcp,
        ttfb: reading.ttfb,
        cls: reading.cls,
        inp: reading.inp,
        'dom-content-loaded': reading.domContentLoaded,
        load: reading.load,
      },
    },
  };
}

const collectPerformance = Effect.fn('collectPerformance')(function* (
  config: CollectorConfig<'performance'>,
  context: SeparateSessionContext,
) {
  const fs = yield* FileSystem.FileSystem;
  const { recipe, directory } = context;
  const samples = config.samples ?? performanceDefaults.samples;
  const warmup = config.warmup ?? performanceDefaults.warmup;
  const page = new URL(recipe.path, context.url).toString();
  const unavailable = (reason: string) =>
    new EvidenceUnavailable({ reason: conceal(reason, context.concealed) });

  yield* fs.makeDirectory(path.join(directory, 'performance'));
  yield* fs.writeFileString(
    path.join(directory, 'performance/observer.js'),
    observerScript,
    { flag: 'wx' },
  );
  context.addArtifact(
    'performance-observer',
    'performance/observer.js',
    'PerformanceObserver script registered before page scripts for timing samples',
  );

  const { width, height, scale } = recipe.viewport;

  yield* context
    .browser([
      '--init-script',
      path.join(directory, 'performance/observer.js'),
      'set',
      'viewport',
      String(width),
      String(height),
      String(scale),
    ])
    .pipe(
      Effect.andThen(
        context.browser(['set', 'media', 'light', 'reduced-motion']),
      ),
      Effect.mapError((error) =>
        unavailable(`The sampling browser did not start: ${describe(error)}`),
      ),
    );

  // Opening a path with a fragment again stays in the same document, and
  // agent-browser refuses about:blank under --allowed-domains, so such a path
  // is reloaded. `open` can return while the previous page is still showing,
  // and a step waiting for text would then pass on that old page, so each run
  // first waits for a new, fully loaded document.
  const journey = Effect.gen(function* () {
    const before = yield* context
      .browser(['eval', 'performance.timeOrigin'])
      .pipe(Effect.flatMap(Schema.decodeUnknownEffect(originSchema)));

    yield* context.browser(['open', page]);

    if (recipe.path.includes('#')) {
      yield* context.browser(['reload']);
    }

    yield* context.browser([
      'wait',
      '--fn',
      `performance.timeOrigin !== ${before.data.result} && document.readyState === 'complete'`,
    ]);
    yield* context.runSteps(recipe.ready);
    yield* context.runSteps(recipe.steps);
  });

  const sample = Effect.fnUntraced(function* (
    run: number,
    previousOrigin: number | null,
  ) {
    const startedAt = DateTime.formatIso(yield* DateTime.now);

    yield* journey.pipe(
      Effect.mapError((error) =>
        unavailable(`Timing run ${run} failed: ${describe(error)}`),
      ),
    );

    const filename = `performance/run-${String(run).padStart(2, '0')}.json`;
    const output = yield* context
      .browser(['eval', '-b', Buffer.from(readScript).toString('base64')])
      .pipe(
        Effect.mapError((error) =>
          unavailable(
            `Timing run ${run} could not be read: ${describe(error)}`,
          ),
        ),
      );
    const finishedAt = DateTime.formatIso(yield* DateTime.now);

    yield* fs.writeFileString(
      path.join(directory, filename),
      redactText(output, context.concealed),
      { flag: 'wx' },
    );
    context.addArtifact(
      `performance-run-${run}`,
      filename,
      `agent-browser eval output for timing run ${run}; credentials redacted`,
    );

    const reading = yield* Schema.decodeUnknownEffect(readingSchema)(
      output,
    ).pipe(
      Effect.mapError(() =>
        unavailable(`Timing run ${run} returned an unexpected reading`),
      ),
    );
    const result = reading.data.result;
    const converted = toSample(result, {
      run,
      warmup: run <= warmup,
      startedAt,
      finishedAt,
      viewport: recipe.viewport,
      previousOrigin,
    });

    return converted.kind === 'rejected'
      ? yield* unavailable(converted.reason)
      : { sample: converted.sample, origin: result.timeOrigin };
  });

  const runs: PerformanceSample[] = [];
  let previousOrigin: number | null = null;

  for (let run = 1; run <= warmup + samples; run += 1) {
    const recorded: { sample: PerformanceSample; origin: number } =
      yield* sample(run, previousOrigin);

    runs.push(recorded.sample);
    previousOrigin = recorded.origin;
  }

  const documents = new Set(
    runs.filter((run) => !run.warmup).map((run) => run.document),
  );

  if (documents.size > 1) {
    return yield* unavailable(
      `Timing runs ended on different documents (${[...documents].join(', ')}), so their samples measure different pages`,
    );
  }

  const inspection: PerformanceInspection =
    config.inspect === true
      ? yield* inspect(context, journey)
      : { kind: 'not-requested' };

  return yield* Schema.decodeUnknownEffect(performanceValueSchema)({
    conditions: {
      samples,
      warmup,
      cpu: 'unthrottled',
      network: 'unthrottled',
      cache: 'warm',
      order: 'sequential',
      viewport: recipe.viewport,
    },
    samples: runs,
    inspection,
  }).pipe(
    Effect.mapError(() => unavailable('Timing samples are inconsistent')),
  );
});

// Tracing and profiling slow the page down, so each gets its own run after
// the samples and never contributes to them. agent-browser writes into a
// temporary directory; only the redacted copy enters the evidence.
const inspect = Effect.fnUntraced(function* (
  context: SeparateSessionContext,
  journey: Effect.Effect<
    void,
    CollectorError | Schema.SchemaError,
    CollectorServices
  >,
) {
  const fs = yield* FileSystem.FileSystem;
  const temporary = yield* fs.makeTempDirectoryScoped({ prefix: 'obs-perf-' });

  const record = (
    tool: 'trace' | 'profiler',
    id: string,
    filename: string,
    description: string,
  ) =>
    Effect.gen(function* () {
      const raw = path.join(temporary, path.basename(filename));

      yield* context.browser([tool, 'start']);
      yield* journey;
      yield* context.browser([tool, 'stop', raw]);
      yield* fs.writeFileString(
        path.join(context.directory, filename),
        redactText(yield* fs.readFileString(raw), context.concealed),
        { flag: 'wx' },
      );
      context.addArtifact(id, filename, description);

      return { kind: 'recorded', artifact: id } as const;
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed({
          kind: 'unavailable',
          reason: conceal(
            `DevTools ${tool} failed: ${describe(error)}`,
            context.concealed,
          ),
        } as const),
      ),
    );

  return {
    kind: 'requested',
    trace: yield* record(
      'trace',
      'performance-trace',
      'performance/trace.json',
      'Chrome DevTools trace of one extra journey run, for inspection only; not a timing sample',
    ),
    profile: yield* record(
      'profiler',
      'performance-profile',
      'performance/profile.json',
      'Chrome DevTools profile of one extra journey run, for inspection only; not a timing sample',
    ),
  } satisfies PerformanceInspection;
}, Effect.scoped);

export const performance: Collector<'performance'> = {
  phase: 'separate-session',
  conditions: (config) => ({
    samples: config.samples ?? performanceDefaults.samples,
    warmup: config.warmup ?? performanceDefaults.warmup,
    cpu: 'unthrottled',
    network: 'unthrottled',
    cache: 'warm',
  }),
  collect: collectPerformance,
};
