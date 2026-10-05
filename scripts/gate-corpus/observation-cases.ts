import { atCheck, project, resultReading, type Pair } from './cases';

export const observationPair: Pair = {
  fixture: 'gate-observations',
  baseProject: { ...project, setup: [] },
  edits: [
    {
      file: 'app.ts',
      from: 'const repetitions = 1;',
      to: 'const repetitions = 2;',
    },
  ],
  expectation: {
    id: 'observation-change',
    gate: 2,
    reason:
      'A second paint changes pixels, final state and execution counts while saved request and text checks pass.',
    exitCode: 0,
    assertions: [
      {
        label: 'conclusion',
        actual: resultReading(['conclusion', 'kind']),
        expected: 'no-regression',
      },
      ...['one-request', 'loaded-text'].map((id) => ({
        label: `${id} stays passed`,
        actual: resultReading(atCheck(id, 'verdict')),
        expected: 'passed',
      })),
      {
        label: 'only the two named checks count',
        actual: resultReading(['journeys', 0, 'checks', 'length']),
        expected: 2,
      },
      {
        label: 'pixel difference is reported',
        actual: resultReading(['journeys', 0, 'comparison', 'visual', 'kind']),
        expected: 'changed',
      },
      {
        label: 'raw PNG artifact bytes differ',
        actual: {
          kind: 'png-different',
          file: 'journey-1/base/screenshot.png',
          other: 'journey-1/candidate/screenshot.png',
        },
        expected: true,
      },
      ...(['base', 'candidate'] as const).flatMap((side) => [
        {
          label: `${side} timeline state matches the raw snapshot`,
          actual: {
            kind: 'timeline-state',
            file: 'result.json',
            side,
            includes: side === 'base' ? 'Paint 1' : 'Paint 2',
          } as const,
          expected: true,
        },
        {
          label: `${side} raw paint executions`,
          actual: {
            kind: 'coverage',
            file: `journey-1/${side}/coverage-raw.json`,
            pathname: '/app.js',
            source: `journey-1/${side}/source/app.ts`,
            line: 3,
            column: 2,
            functionRange: { startOffset: 17, endOffset: 321 },
            measure: 'count',
          } as const,
          expected: side === 'base' ? 1 : 2,
        },
      ]),
    ],
  },
};
