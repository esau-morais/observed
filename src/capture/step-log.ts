import { isDeepStrictEqual } from 'node:util';
import type { EvidenceValue } from '../evidence-kinds';
import type { consoleSchema } from './collectors/browser-errors';
import type { Step } from './recipe';

// One read of agent-browser's page error and console buffers.
export type ErrorReading = {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly page: readonly string[];
  readonly console: (typeof consoleSchema.Type)['data']['messages'];
};

export type StepRecord = {
  readonly outcome: 'completed' | 'failed';
  readonly startedAt: string;
  readonly finishedAt: string;
  // Null when the buffers could not be read after the step.
  readonly errors: ErrorReading | null;
};

// Built by the step loop. `steps` holds one record per step that ran, in
// order. `final` is the read saved as errors.json and console.json after the
// snapshot; it is null until then and on a failed journey.
export type StepLog = {
  readonly before: ErrorReading | null;
  readonly steps: readonly StepRecord[];
  readonly final: ErrorReading | null;
};

type Timeline = EvidenceValue<'timeline'>;
type BrowserErrors = EvidenceValue<'browser-errors'>;
type BrowserError = BrowserErrors['entries'][number];

function stepTarget(step: Step): string | null {
  switch (step.kind) {
    case 'navigate':
      return step.path;
    case 'click':
    case 'fill':
    case 'wait-selector':
      return step.selector;
    case 'click-role':
      return `${step.role} ${JSON.stringify(step.name)}`;
    case 'press':
      return step.key;
    case 'wait-text':
      return JSON.stringify(step.text);
    case 'network-idle':
      return null;
  }
}

export function timelineValue(
  steps: readonly Step[],
  log: StepLog,
  tree: string | null,
): Timeline {
  return {
    steps: steps.map((step, index) => {
      const identity = { index, action: step.kind, target: stepTarget(step) };
      const record = log.steps[index];

      return record === undefined
        ? { ...identity, outcome: 'not-run' }
        : {
            ...identity,
            outcome: record.outcome,
            startedAt: record.startedAt,
            finishedAt: record.finishedAt,
          };
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

// Returns null when `next` does not extend `previous`, which means the producer
// dropped or replaced buffered entries and some errors may be missing.
function appended<T>(
  previous: readonly T[],
  next: readonly T[],
): readonly T[] | null {
  return next.length >= previous.length &&
    isDeepStrictEqual(next.slice(0, previous.length), previous)
    ? next.slice(previous.length)
    : null;
}

export function browserErrorsValue(
  steps: readonly Step[],
  log: StepLog,
): BrowserErrors {
  const entries: BrowserError[] = [];
  let problem: string | null = null;
  let previous: ErrorReading | null = null;

  const add = (step: number | null, reading: ErrorReading) => {
    const page = appended(previous?.page ?? [], reading.page);
    const messages = appended(previous?.console ?? [], reading.console);

    if (page === null || messages === null) {
      problem ??=
        'agent-browser replaced buffered errors or console messages between reads, so some errors may be missing';
    }

    const found = [
      ...(page ?? []).map((text) => ({ source: 'page' as const, text })),
      ...(messages ?? [])
        .filter((message) => message.type === 'error')
        .map((message) => ({ source: 'console' as const, text: message.text })),
    ];

    for (const error of found) {
      entries.push({
        ...error,
        step,
        after: step === null ? null : (previous?.startedAt ?? null),
        seenAt: reading.finishedAt,
      });
    }

    previous = reading;
  };

  if (log.before === null) {
    problem = 'Errors before the first step could not be read';
  } else {
    add(null, log.before);

    const reads = [
      ...log.steps.map((record) => record.errors),
      ...(log.steps.length > 0 ? [log.final] : []),
    ];

    for (const [index, reading] of reads.entries()) {
      const step = Math.min(index, log.steps.length - 1);

      if (reading === null) {
        problem ??= `Errors after step ${step + 1} could not be read`;
        continue;
      }

      add(step, reading);
    }
  }

  let stopped = log.steps.findIndex((record) => record.outcome === 'failed');

  if (stopped === -1 && log.steps.length < steps.length) {
    stopped = log.steps.length;
  }

  let coverage: BrowserErrors['coverage'] = { kind: 'complete' };

  if (problem !== null) {
    coverage = { kind: 'incomplete', reason: problem };
  } else if (stopped !== -1) {
    coverage = {
      kind: 'incomplete',
      reason: `The journey stopped at step ${stopped + 1}, so later steps were not observed`,
    };
  }

  return { steps: steps.length, coverage, entries };
}
