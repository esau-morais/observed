import { DateTime, Effect, Schema } from 'effect';
import { browserErrorsValue, type ErrorReading } from '../step-log';
import type { Collector, CollectorContext } from './define';

const response = <S extends Schema.Constraint>(data: S) =>
  Schema.Struct({ success: Schema.Literal(true), data });

export const errorsSchema = response(
  Schema.Struct({
    errors: Schema.Array(Schema.Struct({ text: Schema.String })),
  }),
);

export const consoleSchema = response(
  Schema.Struct({
    messages: Schema.Array(
      Schema.Struct({ type: Schema.String, text: Schema.String }),
    ),
  }),
);

// agent-browser 0.38.1 keeps both buffers across navigations, and
// `errors --clear` leaves them intact, so each read returns everything so far.
export const readErrors = <E, R>(
  read: (name: 'errors' | 'console') => Effect.Effect<string, E, R>,
) =>
  Effect.gen(function* () {
    const startedAt = DateTime.formatIso(yield* DateTime.now);
    const errors = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(errorsSchema),
    )(yield* read('errors'));
    const messages = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(consoleSchema),
    )(yield* read('console'));

    return {
      startedAt,
      finishedAt: DateTime.formatIso(yield* DateTime.now),
      page: errors.data.errors.map((error) => error.text),
      console: messages.data.messages,
    } satisfies ErrorReading;
  });

const browserRead =
  (browser: CollectorContext['browser']) => (name: 'errors' | 'console') =>
    browser([name]);

export const browserErrors: Collector<'browser-errors'> = {
  phase: 'journey',
  onFailure: true,
  conditions: () => ({ errorReads: 'after-each-step' }),
  collect: (_config, context) =>
    Effect.gen(function* () {
      const final =
        context.steps.final ??
        (yield* readErrors(browserRead(context.browser)).pipe(
          Effect.orElseSucceed(() => null),
        ));

      return browserErrorsValue(context.recipe.steps, {
        ...context.steps,
        final,
      });
    }),
};

export const readStepErrors = (browser: CollectorContext['browser']) =>
  readErrors(browserRead(browser)).pipe(Effect.orElseSucceed(() => null));
