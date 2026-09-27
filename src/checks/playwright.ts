import type { Recipe } from '../capture/recipe';
import type { CheckPair } from '../comparison';
import type { Check, Side, UnknownCheck } from '../comparison-model';
import type {
  PlaywrightTest,
  PlaywrightValue,
} from '../evidence-kinds/playwright';
import { firstLine, summarizeError } from '../playwright-text';

export const importedAuthority = 'Imported from Playwright';

// Stands in for the tests when the run itself can't be read.
const runIdentity = {
  id: 'playwright-run',
  name: 'Playwright tests',
  authority: importedAuthority,
  scope:
    "Imported from Playwright: every test the app's Playwright command ran.",
  expectation: 'Playwright runs the tests and reports each one.',
} as const;

const expectation =
  'Playwright reports the test as passing. Observed counts flaky and skipped tests as unknown.';

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

// Only a test that passed as expected passes; flaky and skipped tests stay
// unknown.
export function testCheck(test: PlaywrightTest): Check {
  const identity = {
    id: `playwright: ${test.id}`,
    name: test.titlePath.join(' › '),
    authority: importedAuthority,
    scope: `Imported from Playwright: ${test.file}:${test.line}${test.project === '' ? '' : `, project ${test.project}`}.`,
    expectation,
  } as const;
  const attempts = test.results.length;
  const last = test.results.at(-1);
  const failure = test.results.find((result) => result.error !== null)?.error;
  const cause =
    failure === undefined || failure === null
      ? ''
      : ` ${summarizeError(failure)}`;
  const markedToFail =
    test.expectedStatus === 'failed' ||
    (test.expectedStatus === null &&
      test.annotations.some((annotation) => annotation.type === 'fail'));

  switch (test.outcome) {
    case 'expected': {
      return {
        ...identity,
        outcome: 'passed',
        actual: last?.status ?? 'passed',
        detail: markedToFail
          ? 'Marked with test.fail() and failed, as expected.'
          : `Passed${attempts > 1 ? ` on attempt ${attempts}` : ''}.`,
      };
    }
    case 'unexpected': {
      let detail = `${last?.status === 'timedOut' ? 'Timed out' : 'Failed'} on ${attempts === 1 ? 'its only attempt' : `all ${attempts} attempts`}.${cause}`;

      if (markedToFail && last?.status === 'passed') {
        detail = 'Marked with test.fail() but passed.';
      }

      return {
        ...identity,
        outcome: 'failed',
        actual: last?.status ?? 'failed',
        detail,
      };
    }
    case 'flaky': {
      const failed = test.results.filter(
        (result) => result.status !== 'passed',
      ).length;

      return {
        ...identity,
        outcome: 'unknown',
        actual: null,
        detail: `Flaky: failed ${failed} of ${plural(attempts, 'attempt')}, then passed. A flaky test is unknown, not passed.${cause}`,
      };
    }
    case 'skipped': {
      const marked = test.annotations.find((annotation) =>
        ['skip', 'fixme'].includes(annotation.type),
      );
      let reason = `${marked?.type === 'fixme' ? 'Marked fixme' : 'Skipped'}${
        marked?.description === undefined || marked.description === null
          ? ''
          : `: ${marked.description}`
      }`;

      if (test.results.some((result) => result.status === 'interrupted')) {
        reason = 'Interrupted before it finished';
      }

      return {
        ...identity,
        outcome: 'unknown',
        actual: null,
        detail: `${reason}. A skipped test is unknown, not passed.`,
      };
    }
  }
}

function unknownRun(detail: string): UnknownCheck {
  return { ...runIdentity, outcome: 'unknown', actual: null, detail };
}

// Why the run as a whole can't stand for the app's tests, if it can't.
function runProblems(value: PlaywrightValue): string[] {
  const problems = value.errors.map(
    (error) =>
      `Playwright reported an error outside any test: ${firstLine(error)}`,
  );

  if (value.tests.length === 0) {
    problems.push('The report lists no tests.');
  }

  if (
    value.exitCode !== null &&
    value.exitCode !== 0 &&
    value.stats.unexpected === 0 &&
    value.errors.length === 0
  ) {
    problems.push(
      `The command exited with code ${value.exitCode} although no test failed.`,
    );
  }

  return problems;
}

export function checksForRun(value: PlaywrightValue): Check[] {
  const problems = runProblems(value);

  return [
    ...(problems.length === 0 ? [] : [unknownRun(problems.join(' '))]),
    ...value.tests.map(testCheck),
  ];
}

// The unknown check a capture without usable Playwright evidence shows, if
// its journey runs the app's Playwright command.
export function unknownPlaywrightChecks(
  recipe: Recipe | null,
  detail: string,
): UnknownCheck[] {
  return recipe?.collectors.some((item) => item.kind === 'playwright') === true
    ? [unknownRun(detail)]
    : [];
}

type CompleteSide = Extract<Side, { execution: 'complete' }>;

function recorded(
  side: CompleteSide,
):
  | { kind: 'recorded'; value: PlaywrightValue }
  | { kind: 'missing'; detail: string }
  | null {
  if (!side.recipe.collectors.some((item) => item.kind === 'playwright')) {
    return null;
  }

  const view = side.evidence.find((item) => item.kind === 'playwright');

  if (view?.kind === 'playwright' && view.status === 'recorded') {
    return { kind: 'recorded', value: view.value };
  }

  return {
    kind: 'missing',
    detail: `Playwright tests evidence unavailable: ${view?.status === 'unavailable' ? view.reason : 'not recorded'}`,
  };
}

function sourceHash(side: CompleteSide, source: string | null) {
  return source === null
    ? undefined
    : side.capture.manifest.source.files.find((file) => file.path === source)
        ?.sha256;
}

// Tests are matched by ID. A test that passed on base and fails on the
// candidate is a regression only when the captures are comparable and its
// test file is byte-identical on both sides; otherwise the expectation itself
// may have changed. A base test the candidate didn't report is unknown.
export function playwrightPairs({
  base,
  candidate,
  mode,
  comparable,
}: {
  base: CompleteSide | null;
  candidate: CompleteSide;
  mode: 'preview' | 'comparison';
  comparable: boolean;
}): CheckPair[] {
  const after = recorded(candidate);

  if (after === null) {
    return [];
  }

  const before = base === null ? null : recorded(base);

  if (after.kind === 'missing') {
    return [
      {
        base: before?.kind === 'missing' ? unknownRun(before.detail) : null,
        candidate: unknownRun(after.detail),
        regression: null,
      },
    ];
  }

  const baseValue = before?.kind === 'recorded' ? before.value : null;
  const baseChecks = baseValue === null ? [] : checksForRun(baseValue);

  const pairs = checksForRun(after.value).map((check): CheckPair => {
    const previous = baseChecks.find((item) => item.id === check.id) ?? null;

    if (
      mode === 'comparison' &&
      previous === null &&
      check.id !== runIdentity.id &&
      check.outcome === 'failed'
    ) {
      return {
        base: null,
        candidate: {
          ...check,
          detail: `${check.detail} Base has no result for this test, so a regression is not established.`,
        },
        regression: null,
      };
    }

    const test = after.value.tests.find(
      (item) => `playwright: ${item.id}` === check.id,
    );

    if (
      mode !== 'comparison' ||
      !comparable ||
      base === null ||
      test === undefined ||
      previous?.outcome !== 'passed' ||
      check.outcome !== 'failed'
    ) {
      return { base: previous, candidate: check, regression: null };
    }

    const beforeHash = sourceHash(base, test.source);
    const afterHash = sourceHash(candidate, test.source);

    if (beforeHash === undefined || beforeHash !== afterHash) {
      return {
        base: previous,
        candidate: {
          ...check,
          detail: `${check.detail} ${
            beforeHash === undefined || afterHash === undefined
              ? 'Observed could not find the test file in both source snapshots'
              : `${test.source ?? test.file} changed between base and candidate`
          }, so a regression is not established.`,
        },
        regression: null,
      };
    }

    return {
      base: previous,
      candidate: check,
      regression: `${check.name} passed on base and failed on the candidate, with the same test file. ${check.detail}`,
    };
  });
  const removed =
    mode === 'comparison'
      ? baseChecks.filter(
          (check) =>
            check.id !== runIdentity.id &&
            !pairs.some((pair) => pair.candidate.id === check.id),
        )
      : [];

  return [
    ...pairs,
    ...removed.map((previous): CheckPair => ({
      base: previous,
      candidate: {
        id: previous.id,
        name: previous.name,
        authority: importedAuthority,
        scope: previous.scope,
        expectation: previous.expectation,
        outcome: 'unknown',
        actual: null,
        detail:
          'Base reported this test and the candidate run did not, so the candidate is unknown.',
      },
      regression: null,
    })),
  ];
}
