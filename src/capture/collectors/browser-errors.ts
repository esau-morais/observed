import { DateTime, Effect, Schema } from 'effect';
import { browserErrorsValue } from '../step-log';
import type { Collector, CollectorContext } from './define';

const errorsSchema = Schema.fromJsonString(
  Schema.Struct({
    data: Schema.Struct({
      errors: Schema.Array(Schema.Struct({ text: Schema.String })),
    }),
  }),
);

const consoleSchema = Schema.fromJsonString(
  Schema.Struct({
    data: Schema.Struct({
      messages: Schema.Array(
        Schema.Struct({ type: Schema.String, text: Schema.String }),
      ),
    }),
  }),
);

// agent-browser 0.38.1 keeps both buffers across navigations, and
// `errors --clear` leaves them intact, so each read returns everything so far.
export const readErrors = (browser: CollectorContext['browser']) =>
  Effect.gen(function* () {
    const startedAt = DateTime.formatIso(yield* DateTime.now);
    const errors = yield* Schema.decodeUnknownEffect(errorsSchema)(
      yield* browser(['errors']),
    );
    const messages = yield* Schema.decodeUnknownEffect(consoleSchema)(
      yield* browser(['console']),
    );

    return {
      startedAt,
      finishedAt: DateTime.formatIso(yield* DateTime.now),
      page: errors.data.errors.map((error) => error.text),
      console: messages.data.messages,
    };
  });

export const browserErrors: Collector<'browser-errors'> = {
  phase: 'journey',
  onFailure: true,
  collect: (_config, context) =>
    readErrors(context.browser).pipe(
      Effect.orElseSucceed(() => null),
      Effect.map((final) =>
        browserErrorsValue(context.recipe.steps, context.steps, final),
      ),
    ),
};
