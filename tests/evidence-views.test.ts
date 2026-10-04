import { Schema } from 'effect';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'vitest';
import type { Observations } from '../src/capture/model';
import { comparisonSchema, type Journey } from '../src/comparison-model';
import type { ReactEvidence } from '../src/evidence-kinds/react';
import { requestDiff } from '../src/request-diff';
import { withoutPlainPasses } from '../src/result-text';
import { outlineJourney } from '../src/viewer/outline';
import { renderTree, treeRows } from '../src/viewer/react-tree';
import { recipe } from './support/request-recipe';

type Request = Observations['requests'][number];

const request = (path: string, status = 200, method = 'GET'): Request => ({
  method,
  origin: 'application',
  path,
  status,
  startedAt: '2026-10-03T14:27:24.670Z',
});

test('the request diff reads a duplicate as a count change, not an added request', () => {
  const rows = requestDiff(
    [request('/api/items'), request('/style.css'), request('/api/user')],
    [
      request('/style.css'),
      request('/api/items'),
      request('/api/items'),
      request('/api/user', 500),
      request('/api/items', 200, 'POST'),
    ],
  );

  expect(rows.map((row) => [row.method, row.path, row.change])).toEqual([
    ['POST', '/api/items', 'added'],
    ['GET', '/api/items', 'count'],
    ['GET', '/api/user', 'status'],
    ['GET', '/style.css', 'same'],
  ]);
  expect(rows[1]).toMatchObject({ base: [200], candidate: [200, 200] });
});

test('a status the browser did not record makes the difference unknown, not changed', () => {
  const rows = requestDiff(
    [request('/login', 0, 'POST'), request('/a', 0), request('/a', 404)],
    [request('/login', 302, 'POST'), request('/a', 0), request('/a', 500)],
  );

  expect(rows.map((row) => [row.path, row.change])).toEqual([
    ['/a', 'status'],
    ['/login', 'unknown'],
  ]);
});

const react = (
  subtree: readonly (readonly [string, number])[],
  counts: Record<string, number>,
  truncated: 'components' | 'subtree' | null = null,
): ReactEvidence => ({
  renderers: [{ version: '19.3.0', build: 'production' }],
  commits: 3,
  components: Object.entries(counts).map(([name, updates]) => ({
    name,
    mounts: 0,
    updates,
  })),
  mounted: Object.keys(counts),
  subtree: subtree.map(([name, depth]) => ({ name, depth, rendered: true })),
  sources: [],
  truncated: {
    components: truncated === 'components',
    mounted: false,
    subtree: truncated === 'subtree',
  },
});

test('the render tree folds unchanged subtrees and never invents a change from a truncated recording', () => {
  const base = react(
    [
      ['App', 0],
      ['Header', 1],
      ['List', 1],
      ['Row', 2],
    ],
    { App: 2, Header: 2, List: 1, Row: 3 },
  );
  const candidate = react(
    [
      ['App', 0],
      ['Header', 1],
      ['List', 1],
      ['Count', 2],
      ['Row', 2],
    ],
    { App: 3, Header: 2, List: 1, Row: 3, Count: 1 },
  );
  const tree = renderTree(base, candidate);
  const [app] = tree.roots;
  const [header, list] = app?.children ?? [];

  expect(app).toMatchObject({
    change: 'more',
    renders: { base: 2, candidate: 3 },
  });
  expect(header?.notable).toBe(0);
  expect(list?.children.map((node) => [node.name, node.change])).toEqual([
    ['Count', 'more'],
    ['Row', 'same'],
  ]);
  expect(list?.children[0]).toMatchObject({
    state: { base: 'absent', candidate: 'rendered' },
    renders: { base: 0, candidate: 1 },
  });
  expect(tree.changedNames).toBe(2);
  expect(
    treeRows(tree, false, new Set()).map((row) =>
      row.kind === 'fold'
        ? `${row.guides}${row.connector}fold ${row.nodes.map((node) => node.name).join()}`
        : `${row.guides}${row.connector}${row.node.name}`,
    ),
  ).toEqual(['App', '├─fold Header', '└─List', '  ├─Count', '  └─fold Row']);

  const after = react(
    [
      ['App', 0],
      ['Count', 1],
    ],
    { App: 2, Count: 1 },
  );
  const countsCut = renderTree(
    react(
      [
        ['App', 0],
        ['Count', 1],
      ],
      { App: 2 },
      'components',
    ),
    after,
  );
  const subtreeCut = renderTree(
    react([['App', 0]], { App: 2, Count: 1 }, 'subtree'),
    after,
  );

  expect(countsCut.roots[0]?.children[0]).toMatchObject({
    change: 'unknown',
    renders: { base: null, candidate: 1 },
  });
  expect(countsCut.changedNames).toBe(0);
  expect(subtreeCut.roots[0]?.children[0]?.state).toEqual({
    base: 'unrecorded',
    candidate: 'rendered',
  });
  expect(subtreeCut.changedNames).toBe(0);
});

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

  if (
    journey === undefined ||
    journey.candidate.execution !== 'complete' ||
    journey.base.execution !== 'complete'
  ) {
    throw new Error('The fixture has one complete journey');
  }

  return journey;
}

function withDuplicate(journey: Journey): Journey {
  const candidate = journey.candidate;

  if (candidate.execution !== 'complete') {
    throw new Error('The fixture candidate is complete');
  }

  const [first] = candidate.observations.requests;

  return {
    ...journey,
    candidate: {
      ...candidate,
      observations: {
        ...candidate.observations,
        requests:
          first === undefined
            ? candidate.observations.requests
            : [...candidate.observations.requests, first],
      },
    },
  };
}

test('a failed request check opens on the request ledger even when steps were recorded', async () => {
  const journey = withDuplicate(await errorsJourney());
  const outline = outlineJourney({
    ...journey,
    base: { ...journey.base, recipe },
    candidate: { ...journey.candidate, recipe },
    checks: journey.checks.map((check) => ({
      ...check,
      id: 'one-items-request',
      name: 'One request per load action',
    })),
  });

  expect(outline.onSteps).toBe(true);
  expect(outline.placement.get('one-items-request')).toBe('requests');
  expect(outline.lead).toBe('requests');
  expect(outline.sections[0]).toMatchObject({
    key: 'requests',
    status: 'failed',
    count: '1 changed · 2 requests',
    open: true,
  });
});

test('with every check passing, the captured application leads and the changed ledger is marked changed', async () => {
  const journey = withDuplicate(await errorsJourney());
  const outline = outlineJourney({
    ...journey,
    checks: journey.checks.map((check) => ({ ...check, verdict: 'passed' })),
  });

  expect(outline.lead).toBe('screenshots');
  expect(outline.sections[0]).toMatchObject({
    key: 'screenshots',
    open: true,
  });
  expect(
    outline.sections.find((section) => section.key === 'requests'),
  ).toMatchObject({ status: 'changed', open: false });
});

test('the passing header drops plain passes but keeps notes about not-run and edited checks', () => {
  expect(
    withoutPlainPasses(
      'Load items: Headline passed on base and candidate. One request passed on base and candidate. This change alters its test file. Not run: Export. Sign in: Errors failed on base and passed on candidate. 2 more checks passed on the candidate.',
      ['Headline', 'One request', 'Export', 'Errors'],
      ['Load items', 'Sign in'],
    ),
  ).toBe(
    'Load items: This change alters its test file. Not run: Export. Sign in: Errors failed on base and passed on candidate.',
  );
  expect(
    withoutPlainPasses(
      'Load items: Headline passed on base and candidate. Sign in: Errors passed on base and candidate.',
      ['Headline', 'Errors'],
      ['Load items', 'Sign in'],
    ),
  ).toBe('');
});
