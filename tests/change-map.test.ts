import { Schema } from 'effect';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { changeMap, type MapSnapshot } from '../src/change-map';
import type { CoverageRecord } from '../src/change-scope';
import {
  comparisonSchema,
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

  expect(
    withoutEvidence.connections
      .filter(
        (item) =>
          item.to === 'file:src/App.jsx' || item.from === 'file:src/App.jsx',
      )
      .map((item) => item.kind),
  ).toEqual(['imports', 'imports', 'imports']);

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
