import type {
  ChangeScope,
  CheckVerdict,
  Comparison,
  ScopeFile,
  VerdictRecipe,
} from './comparison-model';
import { proposedOf } from './comparison-model';
import { verdictLabels } from './result-text';
import { statusWords } from './status-words';

type Recorded = Extract<ChangeScope, { kind: 'recorded' }>;

export const relationLabels = {
  checked: statusWords.checked.word,
  exercised: statusWords.exercised.word,
  'not-observed': statusWords.notObserved.word,
  'outside-captured-source': statusWords.outsideCapturedSource.word,
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

  // The checks describe unchanged behavior only when nothing else changed
  // either; otherwise the result claims nothing about the change.
  if (captured(scope).length === 0) {
    return [
      scope.outside.kind === 'listed' && outside === 0
        ? 'No captured file changed, so the checks describe unchanged behavior.'
        : 'No captured file changed.',
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

export function fileDetail(result: Comparison, file: ScopeFile): string {
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

// The viewer bundles this module, so it joins paths without node:path.
function joined(directory: string, file: string): string {
  const parts: string[] = [];

  for (const part of `${directory}/${file}`.split('/')) {
    if (part === '..') {
      parts.pop();
    } else if (part !== '.' && part !== '') {
      parts.push(part);
    }
  }

  return parts.join('/');
}

// The path people read: from the repository root when Git listed the
// changes, otherwise from the project directory.
export function repositoryPath(scope: ChangeScope, file: ScopeFile): string {
  return scope.kind === 'recorded' && scope.outside.kind === 'listed'
    ? joined(scope.outside.projectDirectory, file.path)
    : file.path;
}

// What the change scope could not record: coverage, the Git listing, or the
// recipe comparison.
export function scopeNotes(result: Comparison): string[] {
  const scope = result.changeScope;

  if (scope.kind === 'unavailable') {
    return [];
  }

  return [
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

export type ShownFile = {
  path: string;
  change: ScopeFile['change'];
  relation: string;
  detail: string;
};

// The changed files inside the captured source: the ones evidence could
// touch. Files outside it are only counted, in the scope line.
export function capturedFiles(result: Comparison): ShownFile[] {
  const scope = result.changeScope;

  return scope.kind === 'unavailable'
    ? []
    : captured(scope).map((file) => ({
        path: repositoryPath(scope, file),
        change: file.change,
        relation: relationLabels[file.relation],
        detail: fileDetail(result, file),
      }));
}

// One line per changed file, then any missing coverage, Git listing, or
// recipe comparison.
export function scopeFileLines(result: Comparison): string[] {
  const scope = result.changeScope;

  if (scope.kind === 'unavailable') {
    return [];
  }

  return [
    ...scope.files.map(
      (file) =>
        `${repositoryPath(scope, file)} (${file.change}): ${relationLabels[file.relation]}. ${fileDetail(result, file)}`,
    ),
    ...scopeNotes(result),
  ];
}

export const recipeLabels = {
  added: statusWords.addedByChange.word,
  removed: statusWords.removedByChange.word,
  altered: statusWords.alteredByChange.word,
  'journey-altered': statusWords.alteredByChange.word,
  'test-file-changed': statusWords.testFileChanged.word,
} satisfies Record<VerdictRecipe['change'], string>;

type RecipeChange = Extract<
  Recorded['recipe'],
  { kind: 'changed' }
>['differences'][number];
type RecipeField = Extract<
  RecipeChange,
  { change: 'altered' }
>['fields'][number];

export function recipeLine(scope: ChangeScope): string | null {
  if (scope.kind !== 'recorded' || scope.recipe.kind !== 'changed') {
    return null;
  }

  const { base, differences } = scope.recipe;

  if (base.kind === 'unusable') {
    return `The base revision has no usable observed.json, so every check is ${statusWords.addedByChange.word.toLowerCase()}.`;
  }

  const counts = (['check', 'journey'] as const).flatMap((subject) =>
    (['altered', 'added', 'removed'] as const).flatMap((change) => {
      const count = differences.filter(
        (item) =>
          item.change === change &&
          (subject === 'check') === (item.check !== undefined),
      ).length;

      return count === 0
        ? []
        : [`${plural(count, subject, `${subject}s`)} ${change}`];
    }),
  );

  return `observed.json differs from the base revision: ${counts.join(' · ')}.`;
}

function shown(value: unknown, limit: number | null): string {
  const text = JSON.stringify(value);

  return limit === null || text.length <= limit
    ? text
    : `${text.slice(0, limit - 1)}…`;
}

function fieldsText(
  fields: readonly RecipeField[],
  limit: number | null,
): string {
  return `Changed: ${fields
    .map(
      (item) =>
        `${item.field} ${shown(item.base, limit)} → ${shown(item.candidate, limit)}`,
    )
    .join('; ')}.`;
}

function verdictWord(verdict: CheckVerdict): string {
  return verdictLabels[verdict.verdict].toLowerCase();
}

function namedVerdicts(verdicts: readonly CheckVerdict[]): string {
  return verdicts
    .map((verdict) => `${verdict.name} (${verdictWord(verdict)})`)
    .join(', ');
}

function journeyLine(
  difference: RecipeChange,
  checks: readonly CheckVerdict[],
  limit: number | null,
): string {
  const lead = `${recipeLabels[difference.change]}: journey ${difference.journey}.`;

  switch (difference.change) {
    case 'added':
      return `${lead} Its checks have no baseline${checks.length === 0 ? '.' : `: ${namedVerdicts(checks)}.`}`;
    case 'removed':
      return `${lead} No capture ran its checks${checks.length === 0 ? '.' : `, so they are unknown: ${checks.map((check) => check.name).join(', ')}.`}`;
    case 'altered':
      return `${lead} Every check in it is unknown. ${fieldsText(difference.fields, limit)}`;
    default:
      return difference satisfies never;
  }
}

function checkLine(
  difference: RecipeChange,
  name: string,
  verdict: CheckVerdict,
  limit: number | null,
): string {
  const lead = `${recipeLabels[difference.change]}: ${name}.`;
  const base = `Base expectation, ${verdictWord(verdict)}: ${verdict.expectation}`;

  switch (difference.change) {
    case 'added':
      return `${lead} ${verdictLabels[verdict.verdict]}, with no baseline: ${verdict.expectation}`;
    case 'removed':
      return `${lead} ${base}`;
    case 'altered': {
      const proposed = proposedOf(verdict.recipe);

      return [
        lead,
        base,
        ...(proposed === undefined
          ? []
          : [
              `${statusWords.proposed.word}, ${verdictLabels[proposed.outcome].toLowerCase()}: ${proposed.expectation}`,
              'The proposal sets no verdict.',
            ]),
        fieldsText(difference.fields, limit),
      ].join(' ');
    }
    default:
      return difference satisfies never;
  }
}

// One line per added, removed or altered journey and check, then each
// imported test whose file changed. Values longer than `limit` characters
// are cut.
export function recipeLines(
  result: Comparison,
  limit: number | null = null,
): string[] {
  const scope = result.changeScope;
  const recipe = scope.kind === 'recorded' ? scope.recipe : null;
  const where = (journey: string) =>
    result.journeys.length + result.removedJourneys.length > 1
      ? `${journey}: `
      : '';
  const journeyChecks = (journey: string) =>
    result.journeys.find((item) => item.title === journey)?.checks ??
    result.removedJourneys.find((item) => item.journey === journey)?.checks ??
    [];
  const lines: string[] = [];

  for (const difference of recipe?.kind === 'changed'
    ? recipe.differences
    : []) {
    const checks = journeyChecks(difference.journey);

    if (difference.check === undefined) {
      lines.push(journeyLine(difference, checks, limit));
    } else {
      const id = difference.check;
      const verdict = checks.find((check) => check.id === id);
      const name = `${where(difference.journey)}${verdict?.name ?? id}`;

      // A capture that did not complete gives verdicts without a label,
      // so they hold no base expectation to show.
      lines.push(
        verdict?.recipe === undefined
          ? `${recipeLabels[difference.change]}: ${name}.${verdict === undefined ? '' : ` ${verdictLabels[verdict.verdict]}.`}`
          : checkLine(difference, name, verdict, limit),
      );
    }
  }

  for (const journey of result.journeys) {
    for (const check of journey.checks) {
      if (check.recipe?.change === 'test-file-changed') {
        lines.push(
          `${recipeLabels['test-file-changed']}: ${where(journey.title)}${check.name}. ${verdictLabels[check.verdict]}.`,
        );
      }
    }
  }

  return lines;
}
