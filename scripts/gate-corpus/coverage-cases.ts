import {
  atCheck,
  measuredAssertions,
  project,
  resultReading,
  type Pair,
} from './cases';
import type { Expectation, Reading } from './check';

type Assertion = Expectation['assertions'][number];
type Selectors = Extract<Reading, { kind: 'json' }>['path'];
const assert = (
  label: string,
  path: Selectors,
  expected: Assertion['expected'],
): Assertion => ({ label, actual: resultReading(path), expected });

const scope: Selectors = [
  'changeScope',
  'files',
  { key: 'path', equals: 'counts.ts' },
];
const connection: Selectors = [
  'changeMap',
  'connections',
  { key: 'kind', equals: 'ran-in' },
];

export const coveragePair: Pair = {
  fixture: 'gate-coverage',
  materialize: [{ from: 'public/counts.js.txt', to: 'public/counts.js' }],
  baseProject: {
    ...project,
    source: {
      entry: 'server.ts',
      paths: ['server.ts', 'counts.ts', 'index.html', 'public'],
    },
    setup: [],
  },
  edits: ['counts.ts', 'public/counts.js', 'public/counts.js.map'].flatMap(
    (file) =>
      [1, 2].map((count) => ({
        file,
        from: `return ${count};`,
        to: file.endsWith('.map')
          ? `return Number(\\"${count}\\");`
          : `return Number("${count}");`,
      })),
  ),
  expectation: {
    id: 'correct-mapped-change',
    gate: 1,
    reason:
      'Equivalent expressions preserve the saved checks; raw CDP distinguishes the executed changed line from the untouched changed function through a shifted source map.',
    exitCode: 0,
    assertions: [
      assert('conclusion', ['conclusion', 'kind'], 'no-regression'),
      ...['one-request', 'loaded-text'].map((id) =>
        assert(`${id} stays passed`, atCheck(id, 'verdict'), 'passed'),
      ),
      ...measuredAssertions(),
      assert('scope recorded', ['changeScope', 'kind'], 'recorded'),
      assert('changed source relation', [...scope, 'relation'], 'exercised'),
      assert('relation comes from coverage', [...scope, 'basis'], 'coverage'),
      assert('executed original line', [...scope, 'lines', 'ran'], [[2, 2]]),
      assert(
        'unexecuted original line',
        [...scope, 'lines', 'notRan'],
        [[6, 6]],
      ),
      assert(
        'saved journey association',
        [...scope, 'journeys'],
        ['Load items'],
      ),
      assert(
        'changed original lines',
        [
          'changeMap',
          'blocks',
          { key: 'id', equals: 'file:counts.ts' },
          'changedLines',
        ],
        [
          [2, 2],
          [6, 6],
        ],
      ),
      assert('connection source', [...connection, 'from'], 'file:counts.ts'),
      assert('connection journey', [...connection, 'to'], 'journey:1'),
      assert('one changed line ran', [...connection, 'ran'], 1),
      assert('one changed line did not run', [...connection, 'notRan'], 1),
      ...(['base', 'candidate'] as const).flatMap((side): Assertion[] => {
        const directory = `journey-1/${side}`;

        return [
          {
            label: `${side} raw request count`,
            actual: resultReading([
              'journeys',
              0,
              side,
              'checks',
              { key: 'id', equals: 'one-request' },
              'actual',
            ]),
            expected: 1,
            raw: {
              kind: 'requests',
              file: `${directory}/requests.har`,
              method: 'GET',
              pathname: '/api/items',
              status: 200,
            },
          },
          {
            label: `${side} raw result text`,
            actual: resultReading([
              'journeys',
              0,
              side,
              'checks',
              { key: 'id', equals: 'loaded-text' },
              'actual',
            ]),
            expected: 'Items loaded',
            raw: {
              kind: 'json',
              file: `${directory}/text-1.json`,
              path: ['data', 'text'],
            },
          },
          {
            label: `${side} raw executed generated line 4 maps to original line 2`,
            actual: {
              kind: 'coverage',
              file: `${directory}/coverage-raw.json`,
              pathname: '/counts.js',
              source: `${directory}/source/public/counts.js`,
              line: 4,
              column: 2,
              measure: 'count',
              functionRange: {
                startOffset: 15,
                endOffset: side === 'base' ? 56 : 66,
              },
            },
            expected: 1,
          },
          {
            label: `${side} raw unexecuted generated line 8 maps to original line 6`,
            actual: {
              kind: 'coverage',
              file: `${directory}/coverage-raw.json`,
              pathname: '/counts.js',
              source: `${directory}/source/public/counts.js`,
              line: 8,
              column: 2,
              measure: 'count',
              functionRange:
                side === 'base'
                  ? { startOffset: 58, endOffset: 96 }
                  : { startOffset: 68, endOffset: 116 },
            },
            expected: 0,
          },
          {
            label: `${side} protected source map`,
            actual: {
              kind: 'json',
              file: `${directory}/source/public/counts.js.map`,
              path: [],
            },
            expected: {
              version: 3,
              file: 'counts.js',
              sources: ['../counts.ts'],
              names: [],
              sourcesContent: [
                `export function requestedCount(): number {\n  return ${side === 'base' ? '1' : 'Number("1")'};\n}\n\nexport function unusedCount(): number {\n  return ${side === 'base' ? '2' : 'Number("2")'};\n}\n`,
              ],
              mappings: ';;AAAA;AACA;AACA;AACA;AACA;AACA;AACA',
            },
          },
        ];
      }),
    ],
  },
};
