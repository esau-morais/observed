import type { EvidenceValue, Step } from '@observed/judge';
import { stepTarget } from '../steps';

export type BrowserError = {
  readonly source: 'page' | 'console';
  readonly text: string;
  readonly at: string;
};

export type StepRecord = {
  readonly outcome: 'completed' | 'failed';
  readonly startedAt: string;
  readonly finishedAt: string;
};

export type JourneyLog = {
  readonly steps: StepRecord[];
  readonly errors: BrowserError[];
};

export function timelineValue(
  steps: readonly Step[],
  log: JourneyLog,
  tree: string | null,
): EvidenceValue<'timeline'> {
  return {
    steps: steps.map((step, index) => {
      const identity = { index, action: step.kind, target: stepTarget(step) };
      const record = log.steps[index];

      return record === undefined
        ? { ...identity, outcome: 'not-run' }
        : { ...identity, ...record };
    }),
    finalState:
      tree === null
        ? {
            kind: 'unavailable',
            reason: 'The journey stopped before its final state was captured',
          }
        : { kind: 'recorded', tree },
  };
}

export function browserErrorsValue(
  steps: readonly Step[],
  log: JourneyLog,
): EvidenceValue<'browser-errors'> {
  const entries = log.errors.map((error) => {
    const step = log.steps.findLastIndex((record) => record.startedAt <= error.at);
    const record = log.steps[step];

    return {
      source: error.source,
      text: error.text,
      step: record === undefined ? null : step,
      after: record === undefined ? null : record.startedAt,
      seenAt: error.at,
    };
  });
  let stopped = log.steps.findIndex((record) => record.outcome === 'failed');

  if (stopped === -1 && log.steps.length < steps.length) {
    stopped = log.steps.length;
  }

  return {
    steps: steps.length,
    coverage:
      stopped === -1
        ? { kind: 'complete' }
        : {
            kind: 'incomplete',
            reason: `The journey stopped at step ${stopped + 1}, so later steps were not observed`,
          },
    entries,
  };
}
