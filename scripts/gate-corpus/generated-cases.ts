import type { Pair } from './cases';
import type { Expectation, Reading } from './check';

type Assertion = Expectation['assertions'][number];
type Selectors = Extract<Reading, { kind: 'json' }>['path'];
const json = (file: string, path: Selectors): Reading => ({
  kind: 'json',
  file,
  path,
});
const result = (path: Selectors): Reading => json('result.json', path);
const assert = (
  label: string,
  path: Selectors,
  expected: Assertion['expected'],
): Assertion => ({
  label,
  actual: result(path),
  expected,
});

function generatedPair(fault: 'error' | 'data', generated: boolean): Pair {
  const file = `public/gate-3-${fault}.js`;
  const from =
    fault === 'error'
      ? "document.querySelector('#output').textContent = 'Invoice detail is ready';"
      : "document.querySelector('#output').textContent = '$120.00';";
  const to =
    fault === 'error'
      ? "throw new Error('Gate 3 invoice detail failed');"
      : "document.querySelector('#output').textContent = '$12.00';";
  const scope: Selectors = [
    'changeScope',
    'files',
    { key: 'path', equals: file },
  ];
  const executedRelation = fault === 'error' ? 'checked' : 'exercised';
  const assertions: [Assertion, ...Assertion[]] = [
    assert(
      'conclusion',
      ['conclusion', 'kind'],
      generated && fault === 'error' ? 'regression' : 'no-regression',
    ),
    assert(
      'saved summary check',
      ['journeys', 0, 'checks', { key: 'id', equals: 'summary' }, 'verdict'],
      'passed',
    ),
    assert('journey count', ['journeys', 'length'], generated ? 2 : 1),
    assert(
      'changed source relation',
      [...scope, 'relation'],
      generated ? executedRelation : 'not-observed',
    ),
    assert(
      'map remains not observed',
      [
        'changeScope',
        'files',
        { key: 'path', equals: `${file}.map` },
        'relation',
      ],
      'not-observed',
    ),
  ];
  for (const side of ['base', 'candidate'] as const) {
    assertions.push({
      label: `${side} saved text matches raw producer`,
      actual: result([
        'journeys',
        0,
        side,
        'checks',
        { key: 'id', equals: 'summary' },
        'actual',
      ]),
      expected: 'One invoice is ready',
      raw: json(`journey-1/${side}/text-1.json`, ['data', 'text']),
    });
    for (const journey of generated ? [1, 2] : [1]) {
      assertions.push({
        label: `${side} journey ${journey} innermost changed-line execution`,
        actual: {
          kind: 'coverage',
          file: `journey-${journey}/${side}/coverage-raw.json`,
          pathname: `/gate-3-${fault}.js`,
          source: `journey-${journey}/${side}/source/${file}`,
          line: 2,
          column: 2,
        },
        expected: journey === 2,
      });
    }
  }

  if (generated) {
    const connection: Selectors = [
      'changeMap',
      'connections',
      { key: 'kind', equals: 'ran-in' },
    ];
    assertions.push(
      assert(
        'proposal targets',
        ['journeys', 1, 'generated', 'targets'],
        [file],
      ),
      assert(
        'proposal reason',
        ['journeys', 1, 'generated', 'reason'],
        'The saved summary journey does not use this action.',
      ),
      assert(
        'proposal reached changed source',
        ['journeys', 1, 'savingProposal', 'files'],
        [file],
      ),
      assert(
        'three fixed baseline checks',
        ['journeys', 1, 'checks', 'length'],
        3,
      ),
      assert(
        'coverage connection names changed file',
        [...connection, 'from'],
        `file:${file}`,
      ),
      assert(
        'coverage connection names generated journey',
        [...connection, 'to'],
        'journey:2',
      ),
      assert('changed line ran', [...connection, 'ran'], 1),
      assert('no changed line missed', [...connection, 'notRan'], 0),
      assert(
        'changed line position',
        [
          'changeMap',
          'blocks',
          { key: 'id', equals: `file:${file}` },
          'changedLines',
        ],
        [[2, 2]],
      ),
    );
    for (const id of [
      'generated-browser-errors',
      'generated-accessibility',
      'generated-server-errors',
    ]) {
      assertions.push(
        assert(
          id,
          ['journeys', 1, 'checks', { key: 'id', equals: id }, 'verdict'],
          fault === 'error' && id === 'generated-browser-errors'
            ? 'regression'
            : 'passed',
        ),
      );
    }

    for (const side of ['base', 'candidate'] as const) {
      for (const [field, expected] of [
        ['targets', [file]],
        ['reason', 'The saved summary journey does not use this action.'],
      ] as const) {
        assertions.push({
          label: `${side} raw proposal ${field}`,
          actual: json(`journey-2/${side}/recipe.json`, ['generated', field]),
          expected,
        });
      }

      const errors = fault === 'error' && side === 'candidate' ? 1 : 0;
      assertions.push({
        label: `${side} browser error count`,
        actual: result([
          'journeys',
          1,
          side,
          'checks',
          { key: 'id', equals: 'generated-browser-errors' },
          'actual',
        ]),
        expected: errors,
        raw: json(`journey-2/${side}/errors.json`, [
          'data',
          'errors',
          'length',
        ]),
      });
      if (fault === 'data') {
        assertions.push({
          label: `${side} wrong data is raw text`,
          actual: result([
            'journeys',
            1,
            side,
            'evidence',
            { key: 'kind', equals: 'text' },
            'value',
            'elements',
            0,
            'value',
          ]),
          expected: side === 'base' ? '$120.00' : '$12.00',
          raw: json(`journey-2/${side}/text-1.json`, ['data', 'text']),
        });
      }
    }

    if (fault === 'data') {
      const finding: Selectors = [
        'journeys',
        1,
        'findings',
        { key: 'evidence', equals: 'text' },
      ];
      assertions.push(
        assert('wrong data has no check IDs', [...finding, 'checks'], []),
        assert(
          'wrong data is a difference',
          [...finding, 'comparison'],
          'changed',
        ),
        assert(
          'text finding names both values',
          [...finding, 'subject'],
          '#output text changed: "$120.00" → "$12.00"',
        ),
      );
    }
  }

  return {
    fixture: 'gate-generated',
    ...(generated ? { generated: `generated-${fault}.json` } : {}),
    edits: [
      { file, from, to },
      { file: `${file}.map`, from, to },
    ],
    expectation: {
      id: `outside-${fault}-${generated ? 'generated' : 'saved'}`,
      gate: 3,
      reason: `An invoice ${fault} fault outside the saved summary journey, ${generated ? 'with' : 'without'} an authored generated journey.`,
      exitCode: generated && fault === 'error' ? 2 : 0,
      assertions,
    },
  };
}

export const generatedPairs: readonly Pair[] = [
  generatedPair('error', false),
  generatedPair('error', true),
  generatedPair('data', false),
  generatedPair('data', true),
];
