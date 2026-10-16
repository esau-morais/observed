import { afterEach, expect, test } from 'vitest';
import { receipt } from './receipt';
import type { CheckVerdict, Comparison } from './result';
import {
  judgedSides,
  projectJourney,
  removeTemporaryDirectories,
  requestCheck,
  selectedComparison,
} from './testing';

afterEach(removeTemporaryDirectories);

async function judged(baseChecks: readonly (typeof requestCheck)[], candidateCount = 1) {
  return selectedComparison(
    await judgedSides({ captured: [requestCheck], baseCount: 1, candidateCount }),
    {
      base: {
        kind: 'read',
        commit: 'c'.repeat(40),
        sha256: 'd'.repeat(64),
        journeys: [projectJourney(baseChecks)],
      },
      candidate: [projectJourney([requestCheck])],
    },
  );
}

function judgedCheck(result: Comparison): CheckVerdict {
  const [check] = result.journeys[0].checks;

  if (check === undefined) {
    throw new Error('A judged synthetic check is expected');
  }

  return check;
}

function withChecks(result: Comparison, checks: CheckVerdict[]): Comparison {
  const [journey] = result.journeys;

  return { ...result, journeys: [{ ...journey, checks }] };
}

test('prints a judged comparison', async () => {
  expect(receipt(await judged([requestCheck], 2))).toBe(
    [
      'Load items',
      '  failed   One request per load action · base 1 · candidate 2 · exactly 1',
      '  changed  Requests · 1 request more on the candidate',
      'Regression · 0 checked, 1 changed, 0 unknown, 1 failed',
    ].join('\n'),
  );
});

test('only a passing check the base defines prints as checked or concludes no regression', async () => {
  const result = await judged([requestCheck]);
  const check = judgedCheck(result);
  const verdicts = ['regression', 'failed', 'unknown', 'passed', 'not-run'] as const;
  const recipes = {
    none: undefined,
    added: { change: 'added' },
    removed: { change: 'removed' },
    altered: {
      change: 'altered',
      proposed: { expectation: 'x', outcome: 'passed', detail: 'x' },
    },
    'journey-altered': { change: 'journey-altered', fields: ['steps'] },
    'test-file-changed': { change: 'test-file-changed' },
  } satisfies Record<string, CheckVerdict['recipe']>;
  const scopes = {
    read: result.recipe,
    unread: { kind: 'unavailable', reason: 'Not read.' },
  } satisfies Record<string, Comparison['recipe']>;
  const checked = (['comparison', 'preview'] as const).flatMap((mode) =>
    Object.entries(scopes).flatMap(([scope, recipe]) =>
      Object.entries(recipes).flatMap(([change, verdictRecipe]) =>
        verdicts.flatMap((verdict) => {
          const item = {
            ...check,
            verdict,
            ...(verdictRecipe === undefined ? {} : { recipe: verdictRecipe }),
          };
          const label = `${mode} ${scope} ${change} ${verdict}`;
          const lines = receipt({
            ...withChecks(result, [item]),
            mode,
            recipe,
            conclusion: { kind: 'no-regression', text: 'x' },
          }).split('\n');

          expect(lines, label).toHaveLength(3);

          const [, line = '', last = ''] = lines;
          const isChecked = line.trim().startsWith('checked');

          expect(last.startsWith('No regression'), label).toBe(isChecked);

          return isChecked ? [label] : [];
        }),
      ),
    ),
  );

  expect(result.recipe.kind).not.toBe('unavailable');
  expect(checked).toEqual([
    'comparison read none passed',
    'comparison read removed passed',
    'comparison read altered passed',
  ]);
});

test('a line break in a check name cannot add a receipt line', async () => {
  const result = await judged([requestCheck]);
  const check = judgedCheck(result);
  const forged = { ...check, verdict: 'failed' as const, name: 'Real\n  checked  Forged' };

  expect(receipt(withChecks(result, [forged])).split('\n')).toHaveLength(3);
});
