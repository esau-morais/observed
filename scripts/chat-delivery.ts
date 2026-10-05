import { repositoryPath } from '../src/change-scope-text';
import type { CheckVerdict, Comparison } from '../src/comparison-model';

// "N of M" names the checks that decided the verdict.
export function checkCount(result: Comparison): string {
  const verdicts = result.journeys.flatMap((journey) => journey.checks);
  const total = verdicts.length;
  const count = (kinds: readonly CheckVerdict['verdict'][]) =>
    verdicts.filter((check) => kinds.includes(check.verdict)).length;
  const noun = total === 1 ? 'check' : 'checks';

  if (total === 0) {
    return 'no named checks';
  }

  switch (result.conclusion.kind) {
    case 'regression':
    case 'check-failed': {
      const unknown = count(['unknown']);
      const notRun = count(['not-run']);

      return `${count(['regression', 'failed'])} of ${total} ${noun} failed${unknown === 0 ? '' : `, ${unknown} unknown`}${notRun === 0 ? '' : `, ${notRun} not run`}`;
    }
    case 'unavailable': {
      const unknown = count(['unknown']);
      const notRun = count(['not-run']);

      return unknown === 0
        ? `${notRun} of ${total} ${noun} not run`
        : `${unknown} of ${total} ${noun} unknown${notRun === 0 ? '' : `, ${notRun} not run`}`;
    }
    case 'no-regression':
    case 'not-checked':
    case 'preview':
      return `${count(['passed'])} of ${total} ${noun} passed`;
  }
}

// Paths only: a file's reason can quote coverage tool output.
export function notObservedPaths(result: Comparison): string[] {
  const scope = result.changeScope;

  return result.mode !== 'preview' && scope.kind === 'recorded'
    ? scope.files.flatMap((file) =>
        file.relation === 'not-observed' ? [repositoryPath(scope, file)] : [],
      )
    : [];
}

export type ChatLinks = {
  name: string;
  pullRequest: string | null;
  pullRequestLabel: string;
  report: string | null;
  run: string | null;
};

export function clip(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

export type ChatState = { channel: string; failing: boolean };

// Edits notify nobody, so only a newly failing result posts a new message,
// and a failing message that turns into no regression also gets a reply.
export function chatAction(
  previous: ChatState | null,
  channel: string,
  result: { failing: boolean; passed: boolean },
): 'post' | 'update' | 'recover' | 'none' {
  const known = previous?.channel === channel ? previous : null;

  if (result.failing && (known === null || !known.failing)) {
    return 'post';
  }

  if (known === null) {
    return 'none';
  }

  return known.failing && result.passed ? 'recover' : 'update';
}
