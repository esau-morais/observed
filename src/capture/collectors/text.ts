import { Effect, Schema } from 'effect';
import { conceal, redact } from '../../redact';
import { BrowserFailure, type Collector } from './define';

const response = <S extends Schema.Constraint>(data: S) =>
  Schema.decodeUnknownEffect(
    Schema.fromJsonString(
      Schema.Struct({ success: Schema.Literal(true), data }),
    ),
  );

const countSchema = Schema.Struct({
  count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

export const text: Collector<'text'> = {
  phase: 'journey',
  collect: ({ selectors }, context) =>
    Effect.forEach(selectors, (selector, index) =>
      Effect.gen(function* () {
        const prefix = `text-${index + 1}`;
        const count = yield* response(countSchema)(
          yield* context.saveOutput(`${prefix}-count`, `${prefix}-count.json`, [
            'get',
            'count',
            selector,
          ]),
        );
        let value: string | null = null;

        if (count.data.count === 1) {
          const observed = yield* response(
            Schema.Struct({ text: Schema.String }),
          )(
            yield* context.saveOutput(prefix, `${prefix}.json`, [
              'get',
              'text',
              selector,
            ]),
          );
          value = observed.data.text;

          if (
            redact(value) !== value ||
            conceal(value, context.concealed) !== value
          ) {
            return yield* new BrowserFailure({
              message:
                'Text observation contains credentials. Exact-text evaluation and screenshot capture are unavailable.',
            });
          }
        }

        return { selector, count: count.data.count, value };
      }),
    ).pipe(Effect.map((elements) => ({ elements }))),
};
