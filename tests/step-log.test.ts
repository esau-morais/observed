import { expect, test } from 'vitest';
import type { Step } from '../src/capture/recipe';
import {
  browserErrorsValue,
  timelineValue,
  type ErrorReading,
  type StepRecord,
} from '../src/capture/step-log';

const steps: Step[] = [
  { kind: 'click', selector: '#load' },
  { kind: 'network-idle' },
];

const at = (second: number) =>
  `2026-09-23T11:59:${String(second).padStart(2, '0')}.000Z`;

function reading(
  second: number,
  page: string[],
  console: ErrorReading['console'] = [],
): ErrorReading {
  return { startedAt: at(second), finishedAt: at(second + 1), page, console };
}

function completed(second: number, errors: ErrorReading | null): StepRecord {
  return {
    outcome: 'completed',
    startedAt: at(second),
    finishedAt: at(second + 1),
    errors,
  };
}

test('attributes each error to the step after which it was first read, bounded by the previous read', () => {
  const loadError = { type: 'error', text: 'Load-time failure' };
  const warning = { type: 'warning', text: 'Not an error' };

  expect(
    browserErrorsValue(steps, {
      before: reading(1, [], [loadError, warning]),
      steps: [
        completed(3, reading(5, ['Error: boom'], [loadError, warning])),
        completed(7, reading(9, ['Error: boom'], [loadError, warning])),
      ],
      final: reading(11, ['Error: boom', 'Error: boom'], [loadError, warning]),
    }),
  ).toEqual({
    steps: 2,
    coverage: { kind: 'complete' },
    entries: [
      {
        source: 'console',
        text: 'Load-time failure',
        step: null,
        after: null,
        seenAt: at(2),
      },
      {
        source: 'page',
        text: 'Error: boom',
        step: 0,
        after: at(1),
        seenAt: at(6),
      },
      {
        source: 'page',
        text: 'Error: boom',
        step: 1,
        after: at(9),
        seenAt: at(12),
      },
    ],
  });
});

test.each([
  {
    name: 'a producer buffer loses earlier entries',
    before: reading(1, ['Error: first']),
    records: [completed(3, reading(5, [])), completed(7, reading(9, []))],
    final: reading(11, ['Error: second']),
    reason: 'replaced buffered errors',
  },
  {
    name: 'a step fails',
    before: reading(1, []),
    records: [{ ...completed(3, reading(5, [])), outcome: 'failed' as const }],
    final: reading(7, []),
    reason: 'stopped at step 1',
  },
  {
    name: 'the journey stops before a step is recorded',
    before: reading(1, []),
    records: [completed(3, reading(5, []))],
    final: reading(7, []),
    reason: 'stopped at step 2',
  },
  {
    name: 'the final read fails',
    before: reading(1, []),
    records: [completed(3, reading(5, [])), completed(7, reading(9, []))],
    final: null,
    reason: 'after step 2 could not be read',
  },
])(
  'marks the error record incomplete when $name',
  ({ before, records, final, reason }) => {
    const { coverage } = browserErrorsValue(steps, {
      before,
      steps: records,
      final,
    });

    expect(coverage.kind).toBe('incomplete');
    expect(coverage.kind === 'incomplete' ? coverage.reason : '').toContain(
      reason,
    );
  },
);

test('lists steps that never ran and no final state after a failed step', () => {
  const value = timelineValue(
    steps,
    {
      before: reading(1, []),
      steps: [{ ...completed(3, null), outcome: 'failed' }],
      final: null,
    },
    null,
  );

  expect(value.steps.map((step) => [step.target, step.outcome])).toEqual([
    ['#load', 'failed'],
    [null, 'not-run'],
  ]);
  expect(value.finalState.kind).toBe('unavailable');
});
