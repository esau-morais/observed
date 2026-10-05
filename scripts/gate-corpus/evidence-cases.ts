import { atCheck, project, resultReading, type Pair } from './cases';
import type { Expectation, Reading } from './check';

type Assertion = Expectation['assertions'][number];
type Selectors = Extract<Reading, { kind: 'json' }>['path'];

const raw = (
  side: 'base' | 'candidate',
  file: string,
  path: Selectors,
): Reading => ({
  kind: 'json',
  file: `journey-1/${side}/${file}`,
  path,
});

function faultAssertions(id: string): [Assertion, ...Assertion[]] {
  return [
    {
      label: 'conclusion',
      actual: resultReading(['conclusion', 'kind']),
      expected: 'regression',
    },
    ...['one-request', 'loaded-text', id].map((check) => ({
      label: `${check} verdict`,
      actual: resultReading(atCheck(check, 'verdict')),
      expected: check === id ? 'regression' : 'passed',
    })),
  ];
}

function counts(id: string, file: string, path: Selectors): Assertion[] {
  return (['base', 'candidate'] as const).map((side) => ({
    label: `${side} ${id} agrees with raw producer count`,
    actual: resultReading([
      'journeys',
      0,
      side,
      'checks',
      { key: 'id', equals: id },
      'actual',
    ]),
    expected: side === 'base' ? 0 : 1,
    raw: raw(side, file, path),
  }));
}

const errorMessage = 'Saved journey error';
const input = [
  "      const input = document.createElement('input');",
  "      input.id = 'item-name';",
  "      input.setAttribute('aria-label', 'Item name');",
  "      document.querySelector('main')?.append(input);",
].join('\n');

export const evidencePairs: readonly Pair[] = [
  {
    expectation: {
      id: 'browser-errors-fault',
      gate: 2,
      reason:
        'A saved click raises one uncaught page error while its request and text checks still pass.',
      exitCode: 2,
      assertions: [
        ...faultAssertions('saved-errors'),
        ...counts('saved-errors', 'errors.json', ['data', 'errors', 'length']),
        {
          label: 'candidate raw error identity',
          actual: {
            kind: 'text',
            file: 'journey-1/candidate/errors.json',
            includes: `Error: ${errorMessage}`,
          },
          expected: true,
        },
        ...(['base', 'candidate'] as const).map((side) => ({
          label: `${side} no console messages`,
          actual: raw(side, 'console.json', ['data', 'messages', 'length']),
          expected: 0,
        })),
      ],
    },
    baseProject: {
      ...project,
      capture: {
        ...project.capture,
        checks: [
          ...project.capture.checks,
          {
            kind: 'browser-errors',
            id: 'saved-errors',
            name: 'No errors during Load items',
            scope: 'The saved click and its completion steps.',
          },
        ],
      },
    },
    edits: [
      {
        file: 'app.ts',
        from: 'export {};',
        to: `button.addEventListener('click', () => { throw new Error('${errorMessage}'); });\n\nexport {};`,
      },
    ],
  },
  {
    expectation: {
      id: 'accessibility-fault',
      gate: 2,
      reason:
        'The saved click adds an input whose accessible name is removed on the candidate.',
      exitCode: 2,
      assertions: [
        ...faultAssertions('saved-accessibility'),
        ...counts('saved-accessibility', 'a11y.json', [
          'data',
          'violations',
          'length',
        ]),
        {
          label: 'raw violation is the unnamed input',
          actual: raw('candidate', 'a11y.json', [
            'data',
            'violations',
            { key: 'id', equals: 'label' },
            'nodes',
            0,
            'target',
          ]),
          expected: ['#item-name'],
        },
        {
          label: 'one element violates the label rule',
          actual: raw('candidate', 'a11y.json', [
            'data',
            'violations',
            { key: 'id', equals: 'label' },
            'nodeCount',
          ]),
          expected: 1,
        },
        ...(['base', 'candidate'] as const).map((side) => ({
          label: `${side} no incomplete audit rules`,
          actual: raw(side, 'a11y.json', ['data', 'incomplete', 'length']),
          expected: 0,
        })),
      ],
    },
    baseProject: {
      ...project,
      capture: {
        ...project.capture,
        checks: [
          ...project.capture.checks,
          {
            kind: 'accessibility',
            id: 'saved-accessibility',
            name: 'No new serious accessibility violations',
            scope: 'The final page after the saved click.',
            impact: 'serious',
          },
        ],
      },
    },
    baseEdits: [
      {
        file: 'app.ts',
        from: "      document.body.dataset.done = 'true';",
        to: `${input}\n      document.body.dataset.done = 'true';`,
      },
    ],
    edits: [
      {
        file: 'app.ts',
        from: "      input.setAttribute('aria-label', 'Item name');",
        to: '',
      },
    ],
  },
];
