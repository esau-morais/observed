import type { ChangeScope, Comparison, ScopeFile } from './comparison-model';

type Recorded = Extract<ChangeScope, { kind: 'recorded' }>;

export const relationLabels = {
  checked: 'Checked',
  exercised: 'Exercised',
  'not-observed': 'Not observed',
  'outside-captured-source': 'Outside the captured source',
} satisfies Record<ScopeFile['relation'], string>;

const basisWords = {
  'stack-frame': 'an error stack frame',
  'component-source': 'a component source',
  'test-location': 'a test location',
  'diff-name-match': 'a name that matches a changed line',
} as const;

function sentence(value: string): string {
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function lineCount(ranges: readonly (readonly [number, number])[]): number {
  return ranges.reduce((sum, [start, end]) => sum + end - start + 1, 0);
}

function listed(values: readonly string[]): string {
  return values.length <= 1
    ? values.join('')
    : `${values.slice(0, -1).join(', ')} and ${values.at(-1) ?? ''}`;
}

function checkNames(result: Comparison, ids: readonly string[]): string[] {
  const named = new Map(
    result.journeys.flatMap((journey) =>
      journey.checks.map((check) => [check.id, check.name] as const),
    ),
  );

  return ids.map((id) => named.get(id) ?? id);
}

function captured(scope: Recorded): ScopeFile[] {
  return scope.files.filter((file) => file.captured);
}

// The change scope in one line, after the check counts.
export function scopeLine(scope: ChangeScope): string {
  if (scope.kind === 'unavailable') {
    return `Change scope unavailable: ${sentence(scope.reason)}`;
  }

  const outside = scope.files.length - captured(scope).length;
  let outsideText = '';

  if (scope.outside.kind === 'unavailable') {
    outsideText = 'Files outside the captured source are unknown.';
  } else if (outside > 0) {
    outsideText = `${plural(outside, 'file', 'files')} changed outside the captured source.`;
  }

  if (captured(scope).length === 0) {
    return [
      'No captured file changed, so the checks describe unchanged behavior.',
      outsideText,
    ]
      .filter((part) => part !== '')
      .join(' ');
  }

  const counts = (['checked', 'exercised', 'not-observed'] as const).flatMap(
    (relation) => {
      const count = scope.files.filter(
        (file) => file.relation === relation,
      ).length;

      return count === 0
        ? []
        : [`${count} ${relationLabels[relation].toLowerCase()}`];
    },
  );

  return [
    `${plural(captured(scope).length, 'captured file', 'captured files')} changed: ${counts.join(' · ')}.`,
    outsideText,
  ]
    .filter((part) => part !== '')
    .join(' ');
}

function fileDetail(result: Comparison, file: ScopeFile): string {
  const journeys = listed(file.journeys);

  if (file.relation === 'checked') {
    return `${listed(checkNames(result, file.checks))} evaluated evidence from ${basisWords[file.basis]} in this file.`;
  }

  if (file.relation === 'exercised' && file.basis === 'coverage') {
    return `${plural(lineCount(file.lines.ran), 'changed line', 'changed lines')} ran in ${journeys}, and ${lineCount(file.lines.notRan)} did not.`;
  }

  if (file.relation === 'exercised' && file.basis === 'diff-name-match') {
    return `${journeys} recorded ${basisWords[file.basis]} in this file. The match is not a resolved location.`;
  }

  if (file.relation === 'exercised') {
    return `${journeys} recorded ${basisWords[file.basis]} in this file.`;
  }

  return sentence(file.reason);
}

// One line per changed file, then any missing coverage or Git listing.
export function scopeFileLines(result: Comparison): string[] {
  const scope = result.changeScope;

  if (scope.kind === 'unavailable') {
    return [];
  }

  return [
    ...scope.files.map(
      (file) =>
        `${file.path} (${file.change}): ${relationLabels[file.relation]}. ${fileDetail(result, file)}`,
    ),
    ...scope.coverage.flatMap((journey) =>
      journey.kind === 'unavailable' && captured(scope).length > 0
        ? [
            `Coverage unavailable${result.journeys.length === 1 ? '' : ` in ${journey.journey}`}: ${sentence(journey.reason)}`,
          ]
        : [],
    ),
    ...(scope.outside.kind === 'unavailable'
      ? [`Files outside the captured source: ${sentence(scope.outside.reason)}`]
      : []),
    ...(scope.recipe.kind === 'unavailable' &&
    scope.files.some((file) => file.path === 'observed.json')
      ? [`Changes to journeys and checks: ${sentence(scope.recipe.reason)}`]
      : []),
  ];
}
