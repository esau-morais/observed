import { expect, test } from 'vitest';
import { treeIds } from '../src/capture/collectors/react';
import {
  evaluateReactRenders,
  reactRenders,
} from '../src/checks/react-renders';
import { renderChanges, type ReactEvidence } from '../src/evidence-kinds/react';

const evidence = (
  components: ReactEvidence['components'],
  mounted: string[],
  truncated = false,
): ReactEvidence => ({
  renderers: [{ version: '19.1.0', build: 'production' }],
  commits: 2,
  components,
  mounted,
  subtree: [],
  sources: [],
  truncated: { components: truncated, mounted: false, subtree: false },
});

const check = {
  kind: 'react-renders',
  id: 'shelf-renders',
  name: 'Shelf renders at most twice',
  scope: 'One Reading click',
  component: 'Shelf',
  maxRenders: 2,
} as const;

test('an absent component name stays unknown instead of passing with zero renders', () => {
  expect(
    evaluateReactRenders(
      check,
      evidence([{ name: 'hh', mounts: 0, updates: 2 }], ['hh']),
    ),
  ).toMatchObject({ outcome: 'unknown', actual: null });
  expect(evaluateReactRenders(check, evidence([], ['App'], true)).outcome).toBe(
    'unknown',
  );
  expect(
    evaluateReactRenders(check, evidence([], ['Shelf'], true)).outcome,
  ).toBe('unknown');
  expect(evaluateReactRenders(check, evidence([], ['Shelf']))).toMatchObject({
    outcome: 'passed',
    actual: 0,
  });
});

test('renders count mounts and updates against an inclusive limit', () => {
  const at = (mounts: number, updates: number) =>
    evaluateReactRenders(
      check,
      evidence([{ name: 'Shelf', mounts, updates }], ['Shelf']),
    );

  expect(at(0, 2)).toMatchObject({ outcome: 'passed', actual: 2 });
  expect(at(1, 2)).toMatchObject({ outcome: 'failed', actual: 3 });
});

test('render changes list added and removed renders by component', () => {
  expect(
    renderChanges(
      evidence(
        [
          { name: 'App', mounts: 0, updates: 2 },
          { name: 'Gone', mounts: 0, updates: 1 },
        ],
        ['App'],
      ),
      evidence(
        [
          { name: 'App', mounts: 0, updates: 3 },
          { name: 'Book', mounts: 2, updates: 0 },
        ],
        ['App', 'Book'],
      ),
    ),
  ).toEqual([
    { name: 'Book', base: 0, candidate: 2 },
    { name: 'App', base: 2, candidate: 3 },
    { name: 'Gone', base: 1, candidate: 0 },
  ]);
});

test('tree IDs come from the first node with each name, ignoring keys', () => {
  const tree = [
    '# React component tree',
    '0 1 - Root',
    '1 2 1 App',
    '4 6 5 button key="reading"',
    '4 7 5 button key="finished"',
    '2 9 2 App',
  ].join('\n');

  expect(treeIds(tree)).toEqual(
    new Map([
      ['Root', '1'],
      ['App', '2'],
      ['button', '6'],
    ]),
  );
});

test('a failure under a different React build is not attributed as a regression', () => {
  const side = (version: string, updates: number) => {
    const value = {
      ...evidence([{ name: 'Shelf', mounts: 0, updates }], ['Shelf']),
      renderers: [{ version, build: 'production' as const }],
    };

    return {
      observations: {
        schemaVersion: 3 as const,
        requests: [],
        browserErrors: [],
        window: {
          startedAt: '2026-09-27T00:00:00.000Z',
          finishedAt: '2026-09-27T00:00:01.000Z',
        },
      },
      evidence: { react: value },
    };
  };

  const pair = (baseVersion: string) => {
    const base = side(baseVersion, 2);
    const candidate = side('19.1.0', 3);
    const evaluated = reactRenders.evaluate({
      definition: check,
      base,
      candidate,
      comparable: true,
    });

    return {
      detail: evaluated.candidate.detail,
      regression: reactRenders.regression?.({
        definition: check,
        base: { ...base, evaluation: evaluated.base ?? evaluated.candidate },
        candidate: { ...candidate, evaluation: evaluated.candidate },
      }),
    };
  };

  expect(pair('19.1.0').regression).not.toBeNull();
  const upgraded = pair('18.3.1');

  expect(upgraded.regression).toBeNull();
  expect(upgraded.detail).toContain('not attributed to the code change');
});
