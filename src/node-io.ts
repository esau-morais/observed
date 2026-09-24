import { Effect, Predicate, Schema } from 'effect';

export class EvidenceIoError extends Schema.TaggedError<EvidenceIoError>()(
  'EvidenceIoError',
  { code: Schema.String, cause: Schema.Defect() },
) {}

export function nodeIo<A>(
  operation: (signal: AbortSignal) => Promise<A>,
): Effect.Effect<A, EvidenceIoError> {
  return Effect.tryPromise({
    try: operation,
    catch: (cause) =>
      new EvidenceIoError({
        code:
          Predicate.hasProperty(cause, 'code') && Predicate.isString(cause.code)
            ? cause.code
            : 'UNKNOWN',
        cause,
      }),
  });
}
