import type { CaptureArtifact } from '@observed/judge';
import { Effect, Schema } from 'effect';

export type NewArtifact = Omit<CaptureArtifact, 'sha256'>;

export type AddArtifact = (artifact: NewArtifact) => void;

export class EvidenceUnavailable extends Schema.TaggedError<EvidenceUnavailable>()(
  'EvidenceUnavailable',
  { reason: Schema.String },
) {}

export class BrowserFailure extends Schema.TaggedError<BrowserFailure>()('BrowserFailure', {
  category: Schema.Literals(['application', 'producer']),
  message: Schema.String,
}) {}

const firstLine = (cause: unknown) =>
  (cause instanceof Error ? cause.message : String(cause))
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '') ?? 'no message';

export const browserCall = <A>(
  what: string,
  call: () => Promise<A>,
  category: BrowserFailure['category'] = 'producer',
) =>
  Effect.tryPromise({
    try: call,
    catch: (cause) => new BrowserFailure({ category, message: `${what}: ${firstLine(cause)}` }),
  });
