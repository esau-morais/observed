import { Effect, Predicate, Schema } from 'effect';
import { getSystemErrorMap } from 'node:util';

const systemErrors = getSystemErrorMap();

export class EvidenceIoError extends Schema.TaggedError<EvidenceIoError>()(
  'EvidenceIoError',
  { code: Schema.String, cause: Schema.Defect() },
) {}

export function nodeIo<A>(
  operation: (signal: AbortSignal) => Promise<A>,
): Effect.Effect<A, EvidenceIoError> {
  return Effect.tryPromise({
    try: operation,
    catch: (cause) => cause,
  }).pipe(
    Effect.catch((cause) => {
      if (
        Predicate.hasProperty(cause, 'code') &&
        Predicate.isString(cause.code) &&
        Predicate.hasProperty(cause, 'errno') &&
        Predicate.isNumber(cause.errno) &&
        systemErrors.get(cause.errno)?.[0] === cause.code
      ) {
        return Effect.fail(new EvidenceIoError({ code: cause.code, cause }));
      }

      return Effect.die(cause);
    }),
  );
}
