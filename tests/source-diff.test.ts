import { expect, test } from 'vitest';
import { diffLines } from '../src/source-diff';

const numbered = (count: number) =>
  Array.from({ length: count }, (_, index) => `line ${index + 1}`);

test('marks three lines of context around a change, as GitHub hunks show them', () => {
  const before = numbered(12);
  const after = before.toSpliced(5, 1, 'changed');

  expect(diffLines(`${before.join('\n')}\n`, `${after.join('\n')}\n`)).toEqual({
    base: [
      'unchanged',
      'unchanged',
      'context',
      'context',
      'context',
      'removed',
      'context',
      'context',
      'context',
      'unchanged',
      'unchanged',
      'unchanged',
    ],
    candidate: [
      'unchanged',
      'unchanged',
      'context',
      'context',
      'context',
      'added',
      'context',
      'context',
      'context',
      'unchanged',
      'unchanged',
      'unchanged',
    ],
  });
});
