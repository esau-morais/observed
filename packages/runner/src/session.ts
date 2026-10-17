import type { Recipe, Step } from '@observed/judge';
import { Effect } from 'effect';
import type { Browser } from 'playwright';
import { browserCall } from './collectors/define';
import { watchNetwork } from './network';
import { runStep, stepTarget, stepTimeoutMs } from './steps';

export type Phase = 'Ready step' | 'Step';

export const openSession = Effect.fnUntraced(function* (options: {
  browser: Browser;
  recipe: Recipe;
  url: string;
  fillValues: ReadonlyMap<string, string>;
  initScripts?: readonly string[];
  onClose?: (closed: boolean) => Effect.Effect<void>;
}) {
  const { recipe } = options;
  const allowed = new Set([new URL(options.url).origin, ...(recipe.allowedOrigins ?? [])]);
  const blocked = new Set<string>();
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
        Effect.flatMap((closed) => options.onClose?.(closed) ?? Effect.void),
      ),
  );

  context.setDefaultTimeout(stepTimeoutMs);

  for (const script of options.initScripts ?? []) {
    yield* browserCall('Adding an init script', () => context.addInitScript(script));
  }

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
  const page = yield* browserCall('Opening a page', () => context.newPage());

  const run = (phase: Phase, step: Step, index: number) =>
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

  const runAll = (phase: Phase, steps: readonly Step[]) =>
    Effect.forEach(steps, (step, index) => run(phase, step, index), { discard: true });

  const open = () =>
    browserCall(
      'Opening the journey path',
      () => page.goto(new URL(recipe.path, options.url).toString()),
      'application',
    );

  return { context, page, network, blocked, run, runAll, open };
});

export type Session = Effect.Success<ReturnType<typeof openSession>>;
