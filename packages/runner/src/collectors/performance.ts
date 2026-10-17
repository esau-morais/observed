import {
  evidenceKinds,
  performanceDefaults,
  type CollectorConfig,
  type PerformanceInspection,
  type PerformanceSample,
  type Recipe,
} from '@observed/judge';
import { DateTime, Effect, FileSystem, Schema } from 'effect';
import path from 'node:path';
import type { Browser } from 'playwright';
import { conceal, redactText } from '../redact';
import { openSession, type Session } from '../session';
import { EvidenceUnavailable, browserCall, type AddArtifact, type BrowserFailure } from './define';

// Added as an init script so the observers exist before page scripts run.
// CLS uses session windows and INP groups event timing entries by
// interaction, as web-vitals defines them. A metric whose observer cannot
// register stays null rather than reading as zero.
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
// TTFB counts from navigation start, as web-vitals does.
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

export const readingSchema = Schema.Struct({
  observer: Schema.Boolean,
  events: Schema.Boolean,
  timeOrigin: Schema.Number,
  document: Schema.String,
  viewport: Schema.Struct({ width: Schema.Number, height: Schema.Number, scale: Schema.Number }),
  interactions: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  lcp: metric,
  fcp: metric,
  cls: metric,
  inp: metric,
  ttfb: metric,
  domContentLoaded: metric,
  load: metric,
});

type Reading = typeof readingSchema.Type;

export type Converted =
  { kind: 'sample'; sample: PerformanceSample } | { kind: 'rejected'; reason: string };

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
    return rejected(`The timing observer did not run on the page in run ${run.run}`);
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
    return rejected(`Browser viewport in run ${run.run} does not match the saved recipe`);
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

export const performanceConditions = (config: CollectorConfig<'performance'>) => ({
  samples: config.samples ?? performanceDefaults.samples,
  warmup: config.warmup ?? performanceDefaults.warmup,
  cpu: 'unthrottled',
  network: 'unthrottled',
  cache: 'warm',
});

// Runs the journey warm-up plus sample times in a browser context of its own,
// after the recorded journey, and reads the observers after each run. Each
// raw reading is kept as performance/run-<n>.json.
export const collectPerformance = Effect.fnUntraced(function* (options: {
  config: CollectorConfig<'performance'>;
  browser: Browser;
  recipe: Recipe;
  url: string;
  directory: string;
  fillValues: ReadonlyMap<string, string>;
  concealed: readonly string[];
  addArtifact: AddArtifact;
  onClose: (closed: boolean) => Effect.Effect<void>;
}) {
  const fs = yield* FileSystem.FileSystem;
  const { recipe, directory, config } = options;
  const samples = config.samples ?? performanceDefaults.samples;
  const warmup = config.warmup ?? performanceDefaults.warmup;
  const unavailable = (reason: string) =>
    new EvidenceUnavailable({ reason: conceal(reason, options.concealed) });
  const describe = (error: BrowserFailure | EvidenceUnavailable) =>
    error._tag === 'EvidenceUnavailable' ? error.reason : error.message;

  yield* fs.makeDirectory(path.join(directory, 'performance'));
  yield* fs.writeFileString(path.join(directory, 'performance/observer.js'), observerScript, {
    flag: 'wx',
  });
  options.addArtifact({
    id: 'performance-observer',
    path: 'performance/observer.js',
    description: 'PerformanceObserver script registered before page scripts for timing samples',
  });

  const session = yield* openSession({
    browser: options.browser,
    recipe,
    url: options.url,
    fillValues: options.fillValues,
    initScripts: [observerScript],
    onClose: options.onClose,
  }).pipe(
    Effect.mapError((error) => unavailable(`The sampling browser did not start: ${error.message}`)),
  );
  const { page } = session;

  // A path that differs only by its fragment stays in the same document, so
  // such a path is reloaded. Each run waits for a new, fully loaded document
  // before its steps.
  const journey = Effect.gen(function* () {
    const before = yield* browserCall('Reading the time origin', () =>
      page.evaluate<number>('performance.timeOrigin'),
    );

    yield* session.open();

    if (recipe.path.includes('#')) {
      yield* browserCall('Reloading the journey path', () => page.reload());
    }

    yield* browserCall('Waiting for a new document', () =>
      page.waitForFunction(
        `performance.timeOrigin !== ${String(before)} && document.readyState === 'complete'`,
      ),
    );
    yield* session.runAll('Ready step', recipe.ready);
    yield* session.runAll('Step', recipe.steps);
  });

  const sample = Effect.fnUntraced(function* (run: number, previousOrigin: number | null) {
    const startedAt = DateTime.formatIso(yield* DateTime.now);

    yield* journey.pipe(
      Effect.mapError((error) => unavailable(`Timing run ${run} failed: ${describe(error)}`)),
    );

    const filename = `performance/run-${String(run).padStart(2, '0')}.json`;
    const output = yield* browserCall('Reading the timing observers', () =>
      page.evaluate<string>(readScript),
    ).pipe(
      Effect.mapError((error) =>
        unavailable(`Timing run ${run} could not be read: ${error.message}`),
      ),
    );
    const finishedAt = DateTime.formatIso(yield* DateTime.now);

    yield* fs.writeFileString(
      path.join(directory, filename),
      redactText(output, options.concealed),
      { flag: 'wx' },
    );
    options.addArtifact({
      id: `performance-run-${run}`,
      path: filename,
      description: `Timing observers read after run ${run}; credentials redacted`,
    });

    const reading = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(readingSchema))(
      output,
    ).pipe(Effect.mapError(() => unavailable(`Timing run ${run} returned an unexpected reading`)));
    const converted = toSample(reading, {
      run,
      warmup: run <= warmup,
      startedAt,
      finishedAt,
      viewport: recipe.viewport,
      previousOrigin,
    });

    return converted.kind === 'rejected'
      ? yield* unavailable(converted.reason)
      : { sample: converted.sample, origin: reading.timeOrigin };
  });

  const runs: PerformanceSample[] = [];
  let previousOrigin: number | null = null;

  for (let run = 1; run <= warmup + samples; run += 1) {
    const recorded: { sample: PerformanceSample; origin: number } = yield* sample(
      run,
      previousOrigin,
    );

    runs.push(recorded.sample);
    previousOrigin = recorded.origin;
  }

  const documents = new Set(runs.filter((run) => !run.warmup).map((run) => run.document));

  if (documents.size > 1) {
    return yield* unavailable(
      `Timing runs ended on different documents (${[...documents].join(', ')}), so their samples measure different pages`,
    );
  }

  const inspection: PerformanceInspection =
    config.inspect === true
      ? yield* inspect({ ...options, session, journey })
      : { kind: 'not-requested' };

  return yield* Schema.decodeUnknownEffect(evidenceKinds.performance.value)({
    conditions: {
      ...performanceConditions(config),
      order: 'sequential',
      viewport: recipe.viewport,
    },
    samples: runs,
    inspection,
  }).pipe(Effect.mapError(() => unavailable('Timing samples are inconsistent')));
}, Effect.scoped);

// Tracing and profiling slow the page down, so each gets its own run after
// the samples and never contributes to them.
const inspect = Effect.fnUntraced(function* (options: {
  browser: Browser;
  session: Session;
  journey: Effect.Effect<void, BrowserFailure>;
  directory: string;
  concealed: readonly string[];
  addArtifact: AddArtifact;
}) {
  const fs = yield* FileSystem.FileSystem;
  const { page, context } = options.session;

  const record = ({
    id,
    filename,
    description,
    around,
  }: {
    id: string;
    filename: string;
    description: string;
    around: (run: Effect.Effect<void, BrowserFailure>) => Effect.Effect<string, BrowserFailure>;
  }) =>
    around(options.journey).pipe(
      Effect.flatMap((text) =>
        fs.writeFileString(
          path.join(options.directory, filename),
          redactText(text, options.concealed),
          {
            flag: 'wx',
          },
        ),
      ),
      Effect.map(() => {
        options.addArtifact({ id, path: filename, description });

        return { kind: 'recorded', artifact: id } as const;
      }),
      Effect.catch((error) =>
        Effect.succeed({
          kind: 'unavailable',
          reason: conceal(`Chrome DevTools recording failed: ${error.message}`, options.concealed),
        } as const),
      ),
    );

  const trace = yield* record({
    id: 'performance-trace',
    filename: 'performance/trace.json',
    description:
      'Chrome DevTools trace of one extra journey run, for inspection only; not a timing sample',
    around: (run) =>
      Effect.gen(function* () {
        yield* browserCall('Starting the trace', () => options.browser.startTracing(page));
        yield* run;

        return (yield* browserCall('Stopping the trace', () =>
          options.browser.stopTracing(),
        )).toString('utf8');
      }),
  });
  const profile = yield* record({
    id: 'performance-profile',
    filename: 'performance/profile.json',
    description:
      'Chrome DevTools profile of one extra journey run, for inspection only; not a timing sample',
    around: (run) =>
      Effect.gen(function* () {
        const cdp = yield* browserCall('Opening a DevTools session', () =>
          context.newCDPSession(page),
        );
        yield* browserCall('Starting the profiler', async () => {
          await cdp.send('Profiler.enable');
          await cdp.send('Profiler.start');
        });
        yield* run;
        const stopped = yield* browserCall('Stopping the profiler', () =>
          cdp.send('Profiler.stop'),
        );

        return JSON.stringify(stopped.profile);
      }),
  });

  return { kind: 'requested', trace, profile } satisfies PerformanceInspection;
});
