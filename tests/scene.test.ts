import { Schema } from 'effect';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'vitest';
import { comparisonSchema, type Journey } from '../src/comparison-model';
import { sceneOf, sourceWindow } from '../src/viewer/scene-model';

async function errorsJourney(): Promise<Journey> {
  const result = Schema.decodeUnknownSync(
    Schema.fromJsonString(comparisonSchema),
  )(
    await readFile(
      path.join(import.meta.dirname, 'fixtures/report/errors-result.json'),
      'utf8',
    ),
  );
  const [journey] = result.journeys;

  if (journey === undefined) {
    throw new Error('The fixture has a journey');
  }

  return journey;
}

test('the red moment restates the recorded check and error, on the step that read it', async () => {
  const journey = await errorsJourney();
  const scene = sceneOf(journey);
  const candidate = scene?.beats.filter((beat) => beat.phase === 'candidate');
  const errors =
    journey.candidate.execution === 'complete'
      ? journey.candidate.evidence.find(
          (view) => view.kind === 'browser-errors',
        )
      : undefined;

  if (
    candidate === undefined ||
    errors?.kind !== 'browser-errors' ||
    errors.status !== 'recorded'
  ) {
    throw new Error('The fixture records browser errors on the candidate');
  }

  const [error] = errors.value.entries;
  const readAt = (error?.step ?? -1) + 1;
  const result = candidate.at(-1);

  expect(
    candidate
      .filter((beat) => (beat.clock?.step ?? 0) < readAt)
      .map((beat) => beat.states.get('errors')?.tone),
  ).not.toContain('regression');
  expect(
    candidate.find((beat) => beat.clock?.step === readAt)?.states.get('errors'),
  ).toMatchObject({ tone: 'regression' });
  expect(
    candidate.find((beat) => beat.clock?.step === readAt)?.states.get('errors')
      ?.line,
  ).toMatch(/^TypeError: Cannot read/);
  expect(result?.states.get('check')).toEqual({
    line: '✕ regression · 0 → 1',
    tone: 'regression',
    busy: false,
  });
  expect(result?.caption).toBe(
    'No browser errors: browser errors 0 before, 1 after. Limit: none allowed.',
  );
  expect(
    scene?.beats
      .filter((beat) => beat.phase === 'base')
      .flatMap((beat) => [...beat.states.values()].map((state) => state.tone)),
  ).not.toContain('regression');
  expect(scene?.beats.at(-1)?.phase).toBe('source');
});

test('a side without recorded steps draws no scene', async () => {
  const journey = await errorsJourney();
  const base = journey.base;

  if (base.execution !== 'complete') {
    throw new Error('The fixture base is complete');
  }

  expect(
    sceneOf({
      ...journey,
      base: {
        ...base,
        evidence: base.evidence.map((view) =>
          view.kind === 'timeline'
            ? {
                kind: 'timeline',
                status: 'unavailable',
                reason: 'Not recorded',
              }
            : view,
        ),
      },
    }),
  ).toBeNull();
});

test('the code frame lists removed lines before added ones and marks the anchor', () => {
  const window = sourceWindow({
    anchor: {
      path: 'base.ts',
      line: 3,
      side: 'candidate',
      basis: 'stack-frame',
      evidence: 'Stack frame 1',
      artifacts: [],
      diff: 'added',
    },
    base: 'function load() {\n  return items();\n}\n',
    candidate:
      'function load() {\n  const loaded = items();\n  throw new Error();\n}\n',
  });

  expect(window).toEqual([
    { text: 'function load() {', change: 'same', number: 1, anchor: false },
    {
      text: '  return items();',
      change: 'removed',
      number: null,
      anchor: false,
    },
    {
      text: '  const loaded = items();',
      change: 'added',
      number: 2,
      anchor: false,
    },
    { text: '  throw new Error();', change: 'added', number: 3, anchor: true },
    { text: '}', change: 'same', number: 4, anchor: false },
  ]);
});
