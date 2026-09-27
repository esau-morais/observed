import { Schema } from 'effect';
import { expect, test } from 'vitest';
import type { Observations } from '../src/capture/model';
import { browserErrors } from '../src/checks/browser-errors';
import { evidenceKinds, type EvidenceValue } from '../src/evidence-kinds';

type ErrorRecord = EvidenceValue<'browser-errors'>;
type BrowserError = ErrorRecord['entries'][number];

const definition = {
  kind: 'browser-errors',
  id: 'no-browser-errors',
  name: 'No browser errors',
  scope: 'One Load items click through completion and network idle.',
  ignore: ['^ResizeObserver loop'],
} as const;

const observations: Observations = {
  schemaVersion: 3,
  requests: [],
  browserErrors: [],
  window: {
    startedAt: '2026-09-23T11:59:54.000Z',
    finishedAt: '2026-09-23T11:59:56.000Z',
  },
};

function stepError(text: string, step: number | null = 0): BrowserError {
  return {
    source: 'console',
    text,
    step,
    after: step === null ? null : '2026-09-23T11:59:54.000Z',
    seenAt: '2026-09-23T11:59:54.300Z',
  };
}

function side(
  entries: BrowserError[],
  coverage: ErrorRecord['coverage'] = { kind: 'complete' },
  steps = 3,
) {
  return {
    observations,
    evidence: {
      'browser-errors': {
        steps,
        coverage,
        entries,
      },
    },
  };
}

function evaluate(input: ReturnType<typeof side>) {
  return browserErrors.evaluate({
    definition,
    base: null,
    candidate: input,
    comparable: false,
  }).candidate;
}

test('counts only errors during steps that no ignore pattern matches', () => {
  expect(
    evaluate(
      side([
        stepError('Font failed before the journey', null),
        stepError(
          'ResizeObserver loop completed with undelivered notifications',
        ),
      ]),
    ),
  ).toEqual({
    outcome: 'passed',
    actual: 0,
    detail:
      'No page or console errors during 3 step(s). 1 ignored by pattern. 1 before the first step, not checked.',
  });
});

test.each([
  {
    name: 'the error record is incomplete',
    input: side([], {
      kind: 'incomplete',
      reason: 'Errors after the last step were not read',
    }),
  },
  {
    name: 'no steps are configured',
    input: side([], { kind: 'complete' }, 0),
  },
])('leaves the check unknown when $name', ({ input }) => {
  expect(evaluate(input)).toMatchObject({ outcome: 'unknown', actual: null });
});

test.each([
  {
    name: 'repeats the base error with a different application port',
    candidate: [stepError('Request to http://127.0.0.1:2222/api/items failed')],
    detail: null,
  },
  {
    name: 'adds an error the base did not have',
    candidate: [
      stepError('Request to http://127.0.0.1:2222/api/items failed'),
      stepError('TypeError: total is undefined', 1),
    ],
    detail:
      'No browser errors: 1 error(s) on the candidate that the base did not have: step 2 console error: TypeError: total is undefined. Base: 1; candidate: 2.',
  },
])(
  'reports a regression only when the candidate $name',
  ({ candidate, detail }) => {
    const base = side([
      stepError('Request to http://127.0.0.1:1111/api/items failed'),
    ]);
    const after = side(candidate);
    const regression = browserErrors.regression?.({
      definition,
      base: { ...base, evaluation: evaluate(base) },
      candidate: { ...after, evaluation: evaluate(after) },
    });

    expect(regression?.detail ?? null).toBe(detail);
  },
);

test('rejects error entries that name a step the capture did not have', () => {
  const decode = Schema.decodeUnknownOption(
    evidenceKinds['browser-errors'].value,
  );

  expect(
    decode({
      steps: 3,
      coverage: { kind: 'complete' },
      entries: [stepError('Out of range', 7)],
    })._tag,
  ).toBe('None');
});
