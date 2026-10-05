import type { Pair } from './cases';
import { atCheck, resultReading } from './cases';

const startupError = "throw new Error('Gate corpus startup failure');\n";
const reason = 'Application exited before readiness; see application.log';

export const startupFailurePair: Pair = {
  expectation: {
    id: 'startup-failure',
    gate: 4,
    reason:
      'A real base process exits before readiness; its checks stay unknown.',
    exitCode: 1,
    assertions: [
      {
        label: 'unavailable conclusion',
        actual: resultReading(['conclusion', 'kind']),
        expected: 'unavailable',
      },
      {
        label: 'base application failure',
        actual: resultReading([
          'journeys',
          0,
          'base',
          'capture',
          'manifest',
          'execution',
        ]),
        raw: {
          kind: 'json',
          file: 'journey-1/base/capture.json',
          path: ['execution'],
        },
        expected: { kind: 'failed', category: 'application', reason },
      },
      {
        label: 'real process error retained',
        actual: {
          kind: 'text',
          file: 'journey-1/base/application.log',
          includes: 'error: Gate corpus startup failure',
        },
        expected: true,
      },
      {
        label: 'failed process exited and was cleaned up',
        actual: {
          kind: 'json',
          file: 'journey-1/base/server-cleanup.json',
          path: ['stopped'],
        },
        expected: true,
      },
      {
        label: 'failed process exit status',
        actual: {
          kind: 'json',
          file: 'journey-1/base/server-cleanup.json',
          path: ['exit'],
        },
        expected: { kind: 'exited', code: 1 },
      },
      ...['one-request', 'loaded-text'].flatMap((id) => [
        {
          label: `${id} base is unknown`,
          actual: resultReading([
            'journeys',
            0,
            'base',
            'checks',
            { key: 'id', equals: id },
            'outcome',
          ]),
          expected: 'unknown',
        },
        {
          label: `${id} cannot establish a regression or pass`,
          actual: resultReading(atCheck(id, 'verdict')),
          expected: 'unknown',
        },
        {
          label: `${id} candidate passes`,
          actual: resultReading([
            'journeys',
            0,
            'candidate',
            'checks',
            { key: 'id', equals: id },
            'outcome',
          ]),
          expected: 'passed',
        },
      ]),
      {
        label: 'candidate request measurement matches the producer',
        actual: resultReading([
          'journeys',
          0,
          'candidate',
          'checks',
          { key: 'id', equals: 'one-request' },
          'actual',
        ]),
        raw: {
          kind: 'requests',
          file: 'journey-1/candidate/requests.har',
          method: 'GET',
          pathname: '/api/items',
          status: 200,
        },
        expected: 1,
      },
    ],
  },
  baseEdits: [
    {
      file: 'server.ts',
      from: 'const root = import.meta.dirname;',
      to: `${startupError}const root = import.meta.dirname;`,
    },
  ],
  edits: [{ file: 'server.ts', from: startupError, to: '' }],
};
