import { Schema } from 'effect';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'vitest';
import {
  comparisonSchema,
  type Comparison,
  type MapBlock,
  type MapConnection,
  type ScopeFile,
} from '../src/comparison-model';
import { layoutGraph } from '../src/viewer/map-layout';
import type { RecordedScope } from '../src/viewer/map-model';
import { indexMap, openLevel, repoPath } from '../src/viewer/map-view';

const fixture = Schema.decodeUnknownSync(
  Schema.fromJsonString(comparisonSchema),
)(
  await readFile(
    path.join(import.meta.dirname, 'fixtures/report/errors-result.json'),
    'utf8',
  ),
);

if (fixture.changeScope.kind !== 'recorded') {
  throw new Error('The fixture records a change scope');
}

const recordedScope = fixture.changeScope;
const evidence = [
  { kind: 'artifact', path: 'journey-1/requests.har' },
] as const;

function file(path: string, changed: boolean): MapBlock {
  return {
    id: `file:${path}`,
    kind: 'file',
    path,
    changed,
    changedLines: changed ? [[1, 1]] : [],
    imports: { kind: 'scanned', unresolved: [] },
  };
}

function notObserved(path: string): ScopeFile {
  return {
    path,
    change: 'modified',
    captured: true,
    relation: 'not-observed',
    basis: 'none',
    reason: 'Coverage recorded no execution of this file.',
    journeys: [],
    checks: [],
  };
}

function imports(from: string, to: string): MapConnection {
  return {
    kind: 'imports',
    from: `file:${from}`,
    to: `file:${to}`,
    change: 'unchanged',
    evidence,
  };
}

function view(
  blocks: MapBlock[],
  connections: MapConnection[],
  files: ScopeFile[],
) {
  const scope: RecordedScope = { ...recordedScope, files };
  const result: Comparison = {
    ...fixture,
    changeScope: scope,
    changeMap: { kind: 'recorded', blocks, connections },
  };

  return indexMap(result, { kind: 'recorded', blocks, connections }, scope);
}

test('requests for static assets share one card and API routes keep their own', () => {
  const routes = [
    '/',
    '/assets/index-D98Em8dn.js',
    '/assets/font.woff2',
    '/api/items',
  ];
  const index = view(
    [
      file('src/a.ts', true),
      { id: 'journey:1', kind: 'journey', title: 'Load items' },
      ...routes.map((route): MapBlock => ({
        id: `route:GET ${route}`,
        kind: 'route',
        method: 'GET',
        path: route,
      })),
    ],
    routes.map((route): MapConnection => ({
      kind: 'requested',
      from: 'journey:1',
      to: `route:GET ${route}`,
      base: { count: 1, statuses: [200] },
      candidate: { count: 1, statuses: [200] },
      evidence,
    })),
    [notObserved('src/a.ts')],
  );
  const level = openLevel(index, index.root);

  expect(level.journeys.map((card) => card.name)).toEqual([
    'Load items',
    'GET /api/items',
    'Static assets (3)',
  ]);
  expect(
    level.journeyLinks.map((link) => [link.to, link.connections.length]),
  ).toEqual([
    ['static-assets', 3],
    ['route:GET /api/items', 1],
  ]);
});

test('config and lockfiles fold into one card and blocks keep their file names', () => {
  const index = view(
    [
      file('package.json', true),
      file('bun.lock', true),
      file('server.ts', true),
    ],
    [],
    ['package.json', 'bun.lock', 'server.ts'].map(notObserved),
  );
  const level = openLevel(index, index.root);

  expect(level.inside.map((card) => card.name)).toEqual([
    'server.ts',
    'Config and lockfiles (2)',
  ]);
  expect(
    openLevel(index, index.root, ['config']).inside.map((card) => card.name),
  ).toEqual(['bun.lock', 'package.json', 'server.ts']);
});

test('folding the unchanged files of a crowded level keeps every connection', () => {
  const quiet = Array.from({ length: 24 }, (_, at) => `src/quiet-${at}.ts`);
  const index = view(
    [file('src/changed.ts', true), ...quiet.map((name) => file(name, false))],
    quiet.map((name) => imports(name, 'src/changed.ts')),
    [notObserved('src/changed.ts')],
  );
  const folded = openLevel(index, index.root);
  const opened = openLevel(index, index.root, ['unchanged']);
  const total = (links: typeof folded.links) =>
    links.reduce((sum, link) => sum + link.connections.length, 0);

  expect(folded.inside.map((card) => card.name)).toEqual([
    'changed.ts',
    '24 unchanged files',
  ]);
  expect(total(folded.links)).toBe(24);
  expect(total(opened.links)).toBe(24);
  expect(opened.inside).toHaveLength(25);
});

test('a directory holding a not observed file never reads checked', () => {
  const checked: ScopeFile = {
    path: 'src/checked.ts',
    change: 'modified',
    captured: true,
    relation: 'checked',
    basis: 'stack-frame',
    journeys: ['Load items'],
    checks: ['one-items-request'],
  };
  const index = view(
    [
      file('src/checked.ts', true),
      file('src/gap.ts', true),
      file('main.ts', true),
    ],
    [],
    [checked, notObserved('src/gap.ts'), notObserved('main.ts')],
  );
  const [directory] = openLevel(index, index.root).inside;

  expect(directory?.kind).toBe('directory');
  expect(directory?.status.label).toBe('not observed');
});

test('paths read from the repository root when the run recorded the project directory', () => {
  const scope: RecordedScope = {
    ...recordedScope,
    outside: { kind: 'listed', projectDirectory: 'examples/request-lab' },
  };

  expect(repoPath(scope, '../../DESIGN.md')).toBe('DESIGN.md');
  expect(repoPath(scope, 'lib/count.ts')).toBe(
    'examples/request-lab/lib/count.ts',
  );
});

test('the map opens on the directory that holds most of the change', () => {
  const inside = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/viewer/d.ts'];
  const index = view(
    [...inside, 'scripts/e.ts'].map((name) => file(name, true)),
    [],
    [...inside, 'scripts/e.ts'].map(notObserved),
  );

  expect(index.root).toBe('');
  expect(index.opening).toBe('src');
});

test('ELK layout is deterministic and routes each edge between its recorded blocks', async () => {
  const nodes = Array.from({ length: 12 }, (_, at) => ({
    id: `n${String(at).padStart(2, '0')}`,
    width: 100,
    height: 40,
    bottom: false,
  }));
  const edges = [{ id: 'long', from: 'n00', to: 'n11' }];
  const options = { maxWidth: 460, nodeGap: 20, rankGap: 40, bottomGap: 80 };
  const first = await layoutGraph(nodes, edges, options);

  expect(await layoutGraph(nodes, edges, options)).toEqual(first);
  expect(first.nodes.size).toBe(nodes.length);

  const from = first.nodes.get('n00');
  const to = first.nodes.get('n11');
  const points = first.edges.get('long') ?? [];

  expect(points[0]?.y).toBe((from?.y ?? 0) + (from?.height ?? 0));
  expect(points.at(-1)?.y).toBe(to?.y);
});
