import { Schema } from 'effect';

export const Verdict = Schema.Literals(['holds', 'fails', 'unknown']);
export type Verdict = typeof Verdict.Type;

// Missing evidence never adds up to a pass: one unknown check keeps the whole
// result unknown unless another check already fails.
export const combine = (verdicts: ReadonlyArray<Verdict>): Verdict => {
  if (verdicts.length === 0) return 'unknown';
  if (verdicts.includes('fails')) return 'fails';
  if (verdicts.includes('unknown')) return 'unknown';
  return 'holds';
};
