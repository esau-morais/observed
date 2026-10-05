import type { Project } from '../../src/project';
import type { Expectation, Reading } from './check';

const requestCheck = {
  kind: 'request-count',
  id: 'one-request',
  name: 'Each Load items click sends one request',
  scope: 'One click through completion.',
  method: 'GET',
  path: '/api/items',
  expectedCount: 1,
  status: 200,
} as const;
const textCheck = {
  kind: 'text',
  id: 'loaded-text',
  name: 'Loading items shows the saved result',
  scope: 'Result after one click.',
  selector: '#result',
  expectedText: 'Items loaded',
} as const;

const screenshots = {
  file: 'journey-1/base/screenshot.png',
  other: 'journey-1/candidate/screenshot.png',
};

export const project = {
  schemaVersion: 1,
  name: 'Gate corpus',
  source: { entry: 'server.ts', paths: ['server.ts', 'app.ts', 'index.html'] },
  setup: [
    [
      'bun',
      'build',
      'app.ts',
      '--outdir',
      'dist',
      '--target',
      'browser',
      '--sourcemap=linked',
    ],
  ],
  start: ['bun', 'server.ts'],
  ready: { path: '/', status: 200 },
  capture: {
    name: 'Load items',
    path: '/',
    ready: [{ kind: 'wait-text', text: 'Load items' }],
    steps: [
      { kind: 'click-role', role: 'button', name: 'Load items' },
      { kind: 'wait-selector', selector: 'body[data-done="true"]' },
      { kind: 'network-idle' },
    ],
    checks: [requestCheck, textCheck],
    viewport: { width: 800, height: 600, scale: 1 },
    browserArguments: ['--no-sandbox'],
  },
} satisfies Project;

type Assertion = Expectation['assertions'][number];
type Selectors = Extract<Reading, { kind: 'json' }>['path'];

export const resultReading = (path: Selectors): Reading => ({
  kind: 'json',
  file: 'result.json',
  path,
});
export const atCheck = (id: string, ...fields: string[]): Selectors => [
  'journeys',
  0,
  'checks',
  { key: 'id', equals: id },
  ...fields,
];

export function measuredAssertions(fault?: {
  id: string;
  evidence?: string;
}): Assertion[] {
  const checks = [
    ...new Set(['one-request', 'loaded-text', ...(fault ? [fault.id] : [])]),
  ];
  const evidence = [
    ...new Set([
      'text',
      ...(fault?.evidence === undefined ? [] : [fault.evidence]),
    ]),
  ];

  return (['base', 'candidate'] as const).flatMap((side) => [
    {
      label: `${side} execution is complete`,
      actual: resultReading(['journeys', 0, side, 'execution']),
      expected: 'complete',
    },
    ...checks.map((id) => ({
      label: `${side} ${id} measured outcome`,
      actual: resultReading([
        'journeys',
        0,
        side,
        'checks',
        { key: 'id', equals: id },
        'outcome',
      ]),
      expected: side === 'candidate' && id === fault?.id ? 'failed' : 'passed',
    })),
    ...evidence.map((kind) => ({
      label: `${side} ${kind} is recorded`,
      actual: resultReading([
        'journeys',
        0,
        side,
        'evidence',
        { key: 'kind', equals: kind },
        'status',
      ]),
      expected: 'recorded',
    })),
  ]);
}

function verdict(id: string, expected: string): Assertion {
  return {
    label: `${id} verdict`,
    actual: resultReading(atCheck(id, 'verdict')),
    expected,
  };
}

function measurement(
  side: 'base' | 'candidate',
  id: string,
  expected: string | number,
): Assertion {
  return {
    label: `${side} ${id} matches raw output`,
    actual: resultReading([
      'journeys',
      0,
      side,
      'checks',
      { key: 'id', equals: id },
      'actual',
    ]),
    expected,
    raw:
      id === 'one-request'
        ? {
            kind: 'requests',
            file: `journey-1/${side}/requests.har`,
            method: 'GET',
            pathname: '/api/items',
            status: 200,
          }
        : {
            kind: 'json',
            file: `journey-1/${side}/text-1.json`,
            path: ['data', 'text'],
          },
  };
}

const protectedRequest = 'Exactly 1 GET /api/items request(s) with status 200.';
const proposedRequest = 'Exactly 2 GET /api/items request(s) with status 200.';

function reportText(includes: string): Assertion {
  return {
    label: `report: ${includes}`,
    actual: { kind: 'text', file: 'report.md', includes },
    expected: true,
  };
}

function protectedText(proposed?: string): Assertion[] {
  return [
    {
      label: 'protected expectation retained',
      actual: resultReading(atCheck('one-request', 'expectation')),
      expected: protectedRequest,
    },
    ...(proposed === undefined
      ? []
      : [
          {
            label: 'proposed expectation retained separately',
            actual: resultReading(
              atCheck('one-request', 'recipe', 'proposed', 'expectation'),
            ),
            expected: proposed,
          },
        ]),
  ];
}

type Edit = { file: string; from: string; to: string };
export type Pair = {
  expectation: Expectation;
  fixture?: string;
  materialize?: readonly { from: string; to: string }[];
  generated?: string;
  edits: readonly Edit[];
  baseEdits?: readonly Edit[];
  baseProject?: Project;
  candidateProject?: Project;
};

const duplicate = {
  file: 'app.ts',
  from: 'const requestCount = 1;',
  to: 'const requestCount = 2;',
};
const correct = {
  file: 'app.ts',
  from: 'const requestCount = 1;',
  to: 'const requestCount = Number("1");',
};

function pair(
  id: string,
  gate: number,
  reason: string,
  conclusion: string,
  exitCode: 0 | 1 | 2,
  edits: readonly Edit[],
  assertions: readonly Assertion[],
  candidateProject?: Project,
): Pair {
  return {
    expectation: {
      id,
      gate,
      reason,
      exitCode,
      assertions: [
        {
          label: 'conclusion',
          actual: resultReading(['conclusion', 'kind']),
          expected: conclusion,
        },
        ...assertions,
      ],
    },
    edits,
    ...(candidateProject === undefined ? {} : { candidateProject }),
  };
}

const rawPassing = [
  measurement('base', 'one-request', 1),
  measurement('candidate', 'one-request', 1),
];
const rawFault = [
  measurement('base', 'one-request', 1),
  measurement('candidate', 'one-request', 2),
];

export const pairs: readonly Pair[] = [
  pair(
    'correct-change',
    1,
    'Equivalent request count expression executes in the saved journey.',
    'no-regression',
    0,
    [correct],
    [
      verdict('one-request', 'passed'),
      verdict('loaded-text', 'passed'),
      ...rawPassing,
      {
        label: 'changed code ran',
        actual: resultReading([
          'changeScope',
          'files',
          { key: 'path', equals: 'app.ts' },
          'relation',
        ]),
        expected: 'exercised',
      },
    ],
  ),
  pair(
    'request-fault',
    2,
    'One click sends two requests instead of one.',
    'regression',
    2,
    [duplicate],
    [
      verdict('one-request', 'regression'),
      verdict('loaded-text', 'passed'),
      ...measuredAssertions({ id: 'one-request' }),
      ...rawFault,
    ],
  ),
  pair(
    'text-fault',
    2,
    'The saved result text is wrong after the click.',
    'regression',
    2,
    [
      {
        file: 'app.ts',
        from: "const resultText = 'Items loaded';",
        to: "const resultText = 'Wrong items';",
      },
    ],
    [
      verdict('loaded-text', 'regression'),
      ...measuredAssertions({ id: 'loaded-text', evidence: 'text' }),
      ...rawPassing,
      measurement('base', 'loaded-text', 'Items loaded'),
      measurement('candidate', 'loaded-text', 'Wrong items'),
    ],
  ),
  pair(
    'relaxed-check',
    5,
    'The candidate hides the duplicate request by raising its expectation to two.',
    'regression',
    2,
    [duplicate],
    [
      {
        label: 'only protected passes count in the complete summary',
        actual: resultReading(['summary']),
        expected: { passed: 1, total: 2 },
      },
      verdict('one-request', 'regression'),
      verdict('loaded-text', 'passed'),
      ...measuredAssertions({ id: 'one-request' }),
      ...rawFault,
      ...protectedText(proposedRequest),
      reportText(
        'Base expectation, regression: Exactly 1 GET /api/items request\\(s\\) with status 200\\.',
      ),
      reportText(
        'Proposed, passed: Exactly 2 GET /api/items request\\(s\\) with status 200\\.',
      ),
      reportText('The proposal sets no verdict\\.'),
      {
        label: 'altered check named',
        actual: resultReading(atCheck('one-request', 'recipe', 'change')),
        expected: 'altered',
      },
      {
        label: 'proposal passes without setting verdict',
        actual: resultReading(
          atCheck('one-request', 'recipe', 'proposed', 'outcome'),
        ),
        expected: 'passed',
      },
    ],
    {
      ...project,
      capture: {
        ...project.capture,
        checks: [{ ...requestCheck, expectedCount: 2 }, textCheck],
      },
    },
  ),
  pair(
    'removed-check',
    5,
    'The candidate removes the check while doubling requests.',
    'regression',
    2,
    [duplicate],
    [
      {
        label: 'only protected passes count in the complete summary',
        actual: resultReading(['summary']),
        expected: { passed: 1, total: 2 },
      },
      verdict('one-request', 'regression'),
      verdict('loaded-text', 'passed'),
      ...measuredAssertions({ id: 'one-request' }),
      ...rawFault,
      ...protectedText(),
      reportText(
        'Removed by this change: Each Load items click sends one request\\. Base expectation, regression: Exactly 1 GET /api/items request\\(s\\) with status 200\\.',
      ),
      {
        label: 'removed check named',
        actual: resultReading(atCheck('one-request', 'recipe', 'change')),
        expected: 'removed',
      },
    ],
    { ...project, capture: { ...project.capture, checks: [textCheck] } },
  ),
  pair(
    'rewritten-journey',
    5,
    'A changed journey cannot claim the original expectation passed.',
    'unavailable',
    1,
    [correct],
    [
      {
        label: 'only protected passes count in the complete summary',
        actual: resultReading(['summary']),
        expected: { passed: 0, total: 2 },
      },
      verdict('one-request', 'unknown'),
      verdict('loaded-text', 'unknown'),
      ...protectedText(protectedRequest),
      ...(['base', 'candidate'] as const).flatMap((side): Assertion[] => [
        {
          label: `${side} rewritten journey completed`,
          actual: resultReading(['journeys', 0, side, 'execution']),
          expected: 'complete',
        },
        {
          label: `${side} changed steps still sent one request`,
          actual: {
            kind: 'requests',
            file: `journey-1/${side}/requests.har`,
            method: 'GET',
            pathname: '/api/items',
            status: 200,
          },
          expected: 1,
        },
        ...['one-request', 'loaded-text'].map((id) => ({
          label: `${side} ${id} stays unknown after step changes`,
          actual: resultReading([
            'journeys',
            0,
            side,
            'checks',
            { key: 'id', equals: id },
            'outcome',
          ]),
          expected: 'unknown',
        })),
      ]),
      {
        label: 'protected steps and proposed steps shown',
        actual: resultReading([
          'changeScope',
          'recipe',
          'differences',
          { key: 'journey', equals: 'Load items' },
          'fields',
        ]),
        expected: [
          {
            field: 'steps',
            base: project.capture.steps,
            candidate: [...project.capture.steps, { kind: 'network-idle' }],
          },
        ],
      },
      reportText('Every check in it is unknown\\.'),
      {
        label: 'altered journey named',
        actual: resultReading(atCheck('one-request', 'recipe', 'change')),
        expected: 'journey-altered',
      },
      {
        label: 'candidate proposal retained',
        actual: resultReading(
          atCheck('one-request', 'recipe', 'proposed', 'outcome'),
        ),
        expected: 'passed',
      },
    ],
    {
      ...project,
      capture: {
        ...project.capture,
        steps: [...project.capture.steps, { kind: 'network-idle' }],
      },
    },
  ),
  {
    ...pair(
      'removed-journey',
      5,
      'Removing a saved journey leaves its protected checks unknown even when the remaining journey passes.',
      'unavailable',
      1,
      [],
      [
        verdict('one-request', 'passed'),
        verdict('loaded-text', 'passed'),
        ...measuredAssertions(),
        ...rawPassing,
        {
          label: 'only the retained journey ran',
          actual: resultReading(['journeys', 'length']),
          expected: 1,
        },
        {
          label: 'removed journey keeps both unknown protected checks',
          actual: resultReading(['removedJourneys']),
          expected: [
            {
              journey: 'Reload items',
              checks: [
                { ...requestCheck, expectation: protectedRequest },
                {
                  ...textCheck,
                  expectation:
                    'Exactly one #result element with text "Items loaded".',
                },
              ].map(({ id, name, scope, expectation }) => ({
                id,
                name,
                scope,
                expectation,
                verdict: 'unknown',
                detail:
                  'This change removes the journey, so no capture ran this check.',
                recipe: { change: 'removed' },
              })),
            },
          ],
        },
        {
          label: 'unknown checks remain in the total',
          actual: resultReading(['summary']),
          expected: { passed: 2, total: 4 },
        },
        {
          label: 'removed journey named in recipe differences',
          actual: resultReading(['changeScope', 'recipe', 'differences']),
          expected: [{ journey: 'Reload items', change: 'removed' }],
        },
        reportText(
          'Removed by this change: journey Reload items\\. No capture ran its checks, so they are unknown: Each Load items click sends one request, Loading items shows the saved result\\.',
        ),
      ],
      project,
    ),
    baseProject: (() => {
      const { capture, ...settings } = project;

      return {
        ...settings,
        journeys: [capture, { ...capture, name: 'Reload items' }],
      };
    })(),
  },
  pair(
    'intentional-copy',
    6,
    'Description copy changes while both named checks still pass.',
    'no-regression',
    0,
    [
      {
        file: 'index.html',
        from: 'Load the saved items.',
        to: 'Load your saved item list.',
      },
    ],
    [
      verdict('one-request', 'passed'),
      verdict('loaded-text', 'passed'),
      ...rawPassing,
      {
        label: 'visual difference remains an observation',
        actual: resultReading(['journeys', 0, 'comparison', 'visual', 'kind']),
        expected: 'changed',
      },
      {
        label: 'raw pixel difference stays on the description line',
        actual: { kind: 'png-bands', ...screenshots },
        expected: { bands: 4, changed: [2] },
      },
      {
        label: 'reported visual change agrees with the raw pixels',
        actual: {
          kind: 'visual-agrees',
          ...screenshots,
          result: 'result.json',
          path: ['journeys', 0, 'comparison', 'visual'],
        },
        expected: true,
      },
      ...(
        [
          ['base', 'Load the saved items.', true],
          ['candidate', 'Load your saved item list.', true],
          ['candidate', 'Load the saved items.', false],
        ] as const
      ).map(([side, includes, expected]) => ({
        label: `${side} raw snapshot ${expected ? 'has' : 'lacks'} "${includes}"`,
        actual: {
          kind: 'text',
          file: `journey-1/${side}/snapshot.json`,
          includes,
        } as const,
        expected,
      })),
    ],
  ),
  pair(
    'outside-source',
    7,
    'Only README.md changes, outside source.paths.',
    'no-regression',
    0,
    [
      {
        file: 'README.md',
        from: 'Original documentation.',
        to: 'Updated documentation.',
      },
    ],
    [
      ...rawPassing,
      {
        label: 'only the outside file changed',
        actual: resultReading(['changeScope', 'files', 'length']),
        expected: 1,
      },
      {
        label: 'outside file listed',
        actual: resultReading([
          'changeScope',
          'files',
          { key: 'path', equals: 'README.md' },
          'relation',
        ]),
        expected: 'outside-captured-source',
      },
      ...(
        [
          ['No captured file changed\\.', true],
          ['1 file changed outside the captured source\\.', true],
          ['- README\\.md \\(modified\\)', true],
          ['Checks cover only their stated expectations and scopes', true],
          ['checks describe unchanged behavior', false],
          ['verified change', false],
          ['safe to merge', false],
        ] as const
      ).map(([includes, expected]) => ({
        label: `report wording: ${includes}`,
        actual: { kind: 'text' as const, file: 'report.md', includes },
        expected,
      })),
    ],
  ),
];
