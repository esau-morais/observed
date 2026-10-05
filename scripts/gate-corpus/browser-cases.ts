import { project, resultReading, type Pair } from './cases';
import { faultAssertions, raw } from './evidence-cases';

const playwrightId = 'playwright: saved.spec.ts › loaded items are saved';

export const browserPairs: readonly Pair[] = [
  {
    fixture: 'gate-react',
    baseProject: {
      ...project,
      setup: [['bun', 'install', '--frozen-lockfile'], ...project.setup],
      capture: {
        ...project.capture,
        collectors: [{ kind: 'text', selectors: ['#result', '#commits'] }],
        checks: [
          ...project.capture.checks,
          {
            kind: 'react-renders',
            id: 'saved-renders',
            name: 'App commits once during the click',
            scope: 'One saved click after the initial mount.',
            component: 'App',
            maxRenders: 1,
          },
        ],
      },
    },
    edits: [
      {
        file: 'app.ts',
        from: 'const extraRender = false;',
        to: 'const extraRender = true;',
      },
    ],
    expectation: {
      id: 'react-renders-fault',
      gate: 2,
      reason:
        'The candidate commits a second App render during the saved click.',
      exitCode: 2,
      assertions: [
        ...faultAssertions('saved-renders'),
        ...(['base', 'candidate'] as const).flatMap((side) => [
          {
            label: `${side} measured renders match the recorder`,
            actual: resultReading([
              'journeys',
              0,
              side,
              'checks',
              { key: 'id', equals: 'saved-renders' },
              'actual',
            ]),
            expected: side === 'base' ? 1 : 2,
            raw: raw(side, 'react-renders.json', [
              'data',
              'result',
              'components',
              { key: 'name', equals: 'App' },
              'updates',
            ]),
          },
          {
            label: `${side} no step-time mount`,
            actual: raw(side, 'react-renders.json', [
              'data',
              'result',
              'components',
              { key: 'name', equals: 'App' },
              'mounts',
            ]),
            expected: 0,
          },
          {
            label: `${side} independent layout-effect counter includes the initial mount`,
            actual: raw(side, 'text-2.json', ['data', 'text']),
            expected: side === 'base' ? '2' : '3',
          },
        ]),
      ],
    },
  },
  {
    fixture: 'gate-playwright',
    baseProject: {
      ...project,
      setup: [
        ['bun', 'install', '--frozen-lockfile'],
        [
          'bun',
          '-e',
          "await Bun.write('saved.spec.ts', Bun.file('saved.spec.ts.txt'))",
        ],
        ['bun', 'run', 'typecheck'],
        ['bun', 'run', 'install-browser'],
        ...project.setup,
      ],
      capture: {
        ...project.capture,
        collectors: [
          { kind: 'playwright', command: ['bun', 'run', 'test:e2e'] },
        ],
      },
    },
    baseEdits: [
      {
        file: 'app.ts',
        from: '      result.textContent = resultText;',
        to: "      result.textContent = resultText;\n      result.setAttribute('data-saved', 'true');",
      },
    ],
    edits: [
      {
        file: 'app.ts',
        from: "result.setAttribute('data-saved', 'true');",
        to: "result.setAttribute('data-saved', 'false');",
      },
    ],
    expectation: {
      id: 'playwright-fault',
      gate: 2,
      reason:
        'An unchanged Playwright assertion catches the candidate marking loaded items unsaved.',
      exitCode: 2,
      assertions: [
        ...faultAssertions(playwrightId),
        ...(['base', 'candidate'] as const).flatMap((side) => [
          {
            label: `${side} imported measurement matches the raw test attempt`,
            actual: resultReading([
              'journeys',
              0,
              side,
              'checks',
              { key: 'id', equals: playwrightId },
              'actual',
            ]),
            expected: side === 'base' ? 'passed' : 'failed',
            raw: raw(side, 'playwright/report.json', [
              'suites',
              0,
              'specs',
              { key: 'title', equals: 'loaded items are saved' },
              'tests',
              0,
              'results',
              0,
              'status',
            ]),
          },
          {
            label: `${side} exactly one test ran`,
            actual: raw(side, 'playwright/report.json', [
              'suites',
              0,
              'specs',
              'length',
            ]),
            expected: 1,
          },
          {
            label: `${side} no suite-level error`,
            actual: raw(side, 'playwright/report.json', ['errors', 'length']),
            expected: 0,
          },
        ]),
      ],
    },
  },
];
