import type { Step } from '@observed/judge';
import { expect, test } from 'vitest';
import { browserErrorsValue, timelineValue } from './journey-log';

const steps: Step[] = [{ kind: 'click', selector: '#load' }, { kind: 'network-idle' }];

const at = (second: number) => `2026-10-15T11:59:${String(second).padStart(2, '0')}.000Z`;

test('attributes each error to the step that started last before it, and readiness errors to none', () => {
  const log = {
    steps: [
      { outcome: 'completed', startedAt: at(3), finishedAt: at(4) },
      { outcome: 'completed', startedAt: at(5), finishedAt: at(6) },
    ] as const,
    errors: [
      { source: 'console', text: 'Load-time failure', at: at(1) },
      { source: 'page', text: 'Error: boom', at: at(4) },
      { source: 'page', text: 'Error: late', at: at(7) },
    ] as const,
  };

  expect(browserErrorsValue(steps, { steps: [...log.steps], errors: [...log.errors] })).toEqual({
    steps: 2,
    coverage: { kind: 'complete' },
    entries: [
      { source: 'console', text: 'Load-time failure', step: null, after: null, seenAt: at(1) },
      { source: 'page', text: 'Error: boom', step: 0, after: at(3), seenAt: at(4) },
      { source: 'page', text: 'Error: late', step: 1, after: at(5), seenAt: at(7) },
    ],
  });
});

test('a journey that stopped reports incomplete errors and steps that did not run', () => {
  const log = {
    steps: [{ outcome: 'failed' as const, startedAt: at(3), finishedAt: at(4) }],
    errors: [],
  };

  expect(browserErrorsValue(steps, log).coverage).toEqual({
    kind: 'incomplete',
    reason: 'The journey stopped at step 1, so later steps were not observed',
  });
  expect(timelineValue(steps, log, null)).toEqual({
    steps: [
      {
        index: 0,
        action: 'click',
        target: '#load',
        outcome: 'failed',
        startedAt: at(3),
        finishedAt: at(4),
      },
      { index: 1, action: 'network-idle', target: null, outcome: 'not-run' },
    ],
    finalState: {
      kind: 'unavailable',
      reason: 'The journey stopped before its final state was captured',
    },
  });
});
