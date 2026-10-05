import type { Expectation } from './check';

const reading = (path: (string | number)[]) => ({
  kind: 'json' as const,
  file: 'result.json',
  path,
});

export const availabilityCases = ['failed-base', 'missing-base'] as const;
export type AvailabilityCase = (typeof availabilityCases)[number];

export function availabilityExpectation(id: AvailabilityCase): Expectation {
  return {
    id,
    gate: 8,
    reason:
      'A passing journey cannot hide another journey with an unavailable base.',
    exitCode: 1,
    assertions: [
      {
        label: 'aggregate conclusion',
        actual: reading(['conclusion', 'kind']),
        expected: 'unavailable',
      },
      {
        label: 'healthy conclusion',
        actual: reading(['journeys', 0, 'conclusion', 'kind']),
        expected: 'no-regression',
      },
      {
        label: 'unavailable journey',
        actual: reading(['journeys', 1, 'conclusion', 'kind']),
        expected: 'unavailable',
      },
      {
        label: 'base execution',
        actual: reading(['journeys', 1, 'base', 'execution']),
        expected: id === 'failed-base' ? 'capture-failed' : 'unavailable',
      },
      {
        label: 'healthy raw request count',
        actual: {
          kind: 'requests',
          file: 'healthy/candidate/requests.har',
          method: 'GET',
          pathname: '/api/items',
          status: 200,
        },
        expected: 1,
      },
    ],
  };
}

export const seededFaults = [
  {
    id: 'passing-above-unavailable',
    file: 'src/comparison.ts',
    from: 'conclusionKinds.find((candidate) => kinds.includes(candidate))',
    to: "(kinds.includes('no-regression') ? 'no-regression' : conclusionKinds.find((candidate) => kinds.includes(candidate)))",
    probe: 'availability',
    requiredFailures: [
      'aggregate conclusion: expected "unavailable", received "no-regression"',
    ],
  },
  {
    id: 'unavailable-as-passing',
    file: 'src/comparison.ts',
    from: "kind: 'unavailable',\n      text:\n        unknown.length > 0",
    to: "kind: 'no-regression',\n      text:\n        unknown.length > 0",
    probe: 'availability',
    requiredFailures: [
      'unavailable journey: expected "unavailable", received "no-regression"',
    ],
  },
  {
    id: 'regression-as-passed',
    file: 'src/comparison.ts',
    from: "return { ...common, verdict: 'regression', detail: regression };",
    to: "return { ...common, verdict: 'passed', detail: regression };",
    probe: 'request-fault',
    requiredFailures: [
      'one-request verdict: expected "regression", received "passed"',
    ],
  },
  {
    id: 'collector-drops-requests',
    file: 'src/capture/agent-browser.ts',
    from: 'requests: har.log.entries.map((entry) => ({',
    to: 'requests: har.log.entries.slice(0, 0).map((entry) => ({',
    probe: 'request-fault',
    requiredFailures: [
      'base one-request matches raw output: expected 1, received 0',
      'candidate one-request matches raw output: expected 2, received 0',
    ],
  },
] as const;

export function detectedFault(
  failures: readonly string[],
  required: readonly string[],
) {
  return required.every((failure) => failures.includes(failure));
}
