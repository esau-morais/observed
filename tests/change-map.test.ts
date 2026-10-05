import { agentDescriptionsSchema, descriptionProblem, type AgentDescriptions } from '../src/agent-descriptions';
import { Schema } from 'effect';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import {
  changeMap,
  repositoryMap,
  snapshotImports,
  type MapSnapshot,
} from '../src/change-map';
import { scopeTable } from '../src/viewer/map-model';
import type { CoverageRecord } from '../src/change-scope';
import {
  comparisonSchema,
  repositoryMapSchema,
  type ChangeMap,
  type Journey,
  type Side,
} from '../src/comparison-model';

const fixture = await readFile(
  path.join(import.meta.dirname, 'fixtures/report/errors-result.json'),
  'utf8',
);
const result = Schema.decodeUnknownSync(
  Schema.fromJsonString(comparisonSchema),
)(fixture);
const [recorded] = result.journeys;
const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

type Files = Record<string, string>;

const base: Files = {
  'src/App.jsx':
    "import { useState } from 'react';\nimport { load } from './api';\nexport const App = () => load();\n",
  'src/api.js': 'export const load = () => 1;\n',
  'src/main.jsx': "import { App } from './App';\nApp();\n",
};
const candidate: Files = {
  ...base,
  'src/App.jsx':
    "import { useState } from 'react';\nimport { load } from './api';\nexport const App = () => load() + 1;\n",
};

async function snapshot(files: Files): Promise<MapSnapshot> {
  const root = await mkdtemp(path.join(tmpdir(), 'observed-map-'));

  directories.push(root);

  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
  }

  return { root, files: new Map(Object.entries(files)) };
}

// Marks a side's snapshot copy of `file` as failing its integrity check.
function unverified(side: Side, file: string): Side {
  const id = side.capture?.manifest.artifacts.find(
    (item) => item.path === `source/${file}`,
  )?.id;

  return {
    ...side,
    artifacts: side.artifacts.map((item) =>
      item.id === id
        ? {
            id: item.id,
            description: item.description,
            integrity: 'unavailable',
            reason: 'Hash mismatch',
          }
        : item,
    ),
  };
}

async function build(
  journey: Journey,
  coverage: CoverageRecord = { kind: 'unavailable', reason: 'None' },
) {
  const map = changeMap({
    scope: result.changeScope,
    journeys: [{ journey, coverage }],
    snapshots: {
      journey,
      base: await snapshot(base),
      candidate: await snapshot(candidate),
    },
  });

  if (map.kind !== 'recorded') {
    throw new Error(`Expected a recorded map: ${map.reason}`);
  }

  return map;
}

function edges(map: Extract<ChangeMap, { kind: 'recorded' }>) {
  return map.connections.map(
    (connection) => `${connection.from} ${connection.kind} ${connection.to}`,
  );
}

test('imports connect the changed file to the files it imports and that import it', async () => {
  const map = await build(recorded);

  expect(edges(map)).toEqual(
    expect.arrayContaining([
      'file:src/App.jsx imports package:react',
      'file:src/App.jsx imports file:src/api.js',
      'file:src/main.jsx imports file:src/App.jsx',
    ]),
  );
});

test('an import whose snapshot copy failed its integrity check draws no connection', async () => {
  const journey: Journey = {
    ...recorded,
    base: unverified(recorded.base, 'src/main.jsx'),
    candidate: unverified(recorded.candidate, 'src/main.jsx'),
  };
  const map = await build(journey);

  expect(edges(map)).not.toContain(
    'file:src/main.jsx imports file:src/App.jsx',
  );
  expect(map.blocks.map((block) => block.id)).not.toContain(
    'file:src/main.jsx',
  );
});

test('a journey connects to a changed file only through a finding or coverage that ran its lines', async () => {
  const withoutEvidence = await build(
    { ...recorded, findings: [] },
    {
      kind: 'recorded',
      files: new Map([
        ['src/App.jsx', { executed: [[1, 2]], unexecuted: [[3, 3]] }],
      ]),
      excluded: new Map(),
      unmapped: [],
    },
  );

  const touching = withoutEvidence.connections.filter(
    (item) =>
      item.to === 'file:src/App.jsx' || item.from === 'file:src/App.jsx',
  );

  expect(touching).not.toHaveLength(0);
  expect(touching.every((item) => item.kind === 'imports')).toBe(true);

  const withFinding = await build(recorded);

  expect(edges(withFinding)).toEqual(
    expect.arrayContaining([
      'journey:1 threw-at file:src/App.jsx',
      'file:src/App.jsx checked-by journey:1',
    ]),
  );
});

test('a connection without evidence is rejected', () => {
  const map = result.changeMap;

  if (map.kind !== 'recorded') {
    throw new Error('The fixture map is recorded');
  }

  const [first, ...rest] = map.connections;

  if (first === undefined) {
    throw new Error('The fixture map has connections');
  }

  expect(() =>
    Schema.decodeUnknownSync(comparisonSchema)({
      ...result,
      changeMap: { ...map, connections: [{ ...first, evidence: [] }, ...rest] },
    }),
  ).toThrow();
});

test('a not-observed file never renders as passed or checked', () => {
  const scope = result.changeScope;

  if (scope.kind !== 'recorded') {
    throw new Error('The fixture scope is recorded');
  }

  const { rows } = scopeTable({
    ...result,
    changeScope: {
      ...scope,
      files: scope.files.map((file) => ({
        path: file.path,
        change: file.change,
        captured: true,
        relation: 'not-observed',
        basis: 'none',
        reason: 'Coverage recorded no execution of this file.',
        journeys: [],
        checks: [],
      })),
    },
  });

  expect(rows[0]?.chip).toMatchObject({
    label: 'Not observed',
    tone: 'unknown',
  });
  expect(JSON.stringify(rows)).not.toMatch(/passed|checked/i);
});

// Resolving a package name makes Bun install it, so bare names other than
// the snapshot's own aliases must never reach the resolver.
test('bare package names never reach the resolver, and only the nearest config supplies aliases', async () => {
  const resolve = vi.spyOn(Bun, 'resolveSync');
  const imports = snapshotImports(
    await snapshot({
      'tsconfig.json':
        '{ // aliases\n "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"], "@*": ["x/*"] } } }',
      'web/jsconfig.json':
        '{ "compilerOptions": { "paths": { "left-pad": ["./pad.js"] } } }',
      'docs/tsconfig.json': '{ not json',
      'src/a.ts':
        "import pad from 'left-pad';\nimport { b } from '@/b';\nimport { c } from '@scope/c';\nimport { d } from './missing';\nexport const a = pad + b + c + d;\n",
      'src/b.ts': 'export const b = 1;\n',
    }),
  );

  expect(imports.get('src/a.ts')).toEqual({
    kind: 'scanned',
    targets: [
      { kind: 'package', name: 'left-pad' },
      { kind: 'file', path: 'src/b.ts' },
      { kind: 'package', name: '@scope/c' },
    ],
    unresolved: ['./missing'],
  });
  expect(resolve.mock.calls.map(([specifier]) => specifier).sort()).toEqual([
    './missing',
    '@/b',
  ]);
});

test('an import the change removed stays on the map, marked removed', async () => {
  const map = changeMap({
    scope: result.changeScope,
    journeys: [],
    snapshots: {
      journey: recorded,
      base: await snapshot(base),
      candidate: await snapshot({
        ...candidate,
        'src/App.jsx':
          "import { useState } from 'react';\nexport const App = () => 2;\n",
      }),
    },
  });

  expect(map.kind === 'recorded' ? map.connections : []).toContainEqual(
    expect.objectContaining({
      kind: 'imports',
      from: 'file:src/App.jsx',
      to: 'file:src/api.js',
      change: 'removed',
    }),
  );
});

test('repository chips use all candidate lines and retain files without readable source', async () => {
  const source = await snapshot(candidate);
  const coverage: CoverageRecord = { kind: 'recorded', files: new Map([
    ['src/api.js', { executed: [[1, 1]], unexecuted: [] }],
  ]), excluded: new Map(), unmapped: [] };
  const repository = repositoryMap({
    journeys: [{ journey: { ...recorded, findings: [] }, coverage, sources: { base: null, candidate: source } }],
    snapshot: { journey: recorded, source },
  });
  expect(repository.kind).toBe('recorded');
  if (repository.kind !== 'recorded') { throw new Error(repository.reason); }
  expect(repository.files.map((file) => file.path).sort()).toEqual(recorded.candidate.capture?.manifest.source.files.map((file) => file.path).sort());
  expect(repository.files.find((file) => file.path === 'src/api.js')).toMatchObject({ relation: 'exercised', lines: { ran: [[1, 1]] } });
  expect(repository.files.find((file) => file.path === 'src/app.css')).toMatchObject({ relation: 'not-observed' });
  expect(repository.map.kind).toBe('recorded');
  if (repository.map.kind === 'recorded') {
    expect(repository.map.connections.filter((edge) => edge.kind === 'imports').every((edge) => edge.change === 'unchanged')).toBe(true);
  }
  expect(Schema.is(repositoryMapSchema)(repository)).toBe(true);
});

test('agent descriptions cannot invent snapshot files or connections', async () => {
  const source = await snapshot(candidate);
  const repository = repositoryMap({ journeys: [], snapshot: { journey: recorded, source } });
  const descriptions = { schemaVersion: 1, blocks: [{ target: { kind: 'file', path: 'src/App.jsx' }, name: 'Items screen', text: 'Loads the item list.', sources: ['src/App.jsx'] }], connections: [] } satisfies AgentDescriptions;
  expect(descriptionProblem(descriptions, repository, { kind: 'unavailable', reason: 'No change' })).toBeNull();
  expect(descriptionProblem({ ...descriptions, blocks: [{ ...descriptions.blocks[0], sources: ['private/secret.ts'] }] }, repository, { kind: 'unavailable', reason: 'No change' })).toContain('outside');
  expect(descriptionProblem({ ...descriptions, connections: [{ kind: 'imports', from: 'file:src/App.jsx', to: 'file:invented.js', text: 'Reads data.', sources: ['src/App.jsx'] }] }, repository, { kind: 'unavailable', reason: 'No change' })).toContain('absent');
  expect(Schema.is(agentDescriptionsSchema)({ ...descriptions, blocks: [{ ...descriptions.blocks[0], text: 'word '.repeat(26) }] })).toBe(false);
});
