import { isDeepStrictEqual } from 'node:util';
import type { CheckDefinition } from './checks';
import type { RecipeScope, RecipeSources } from './comparison-model';
import {
  defaultMaxAgeMs,
  defaultViewport,
  journeyChecks,
  type Journey,
} from './project';

type Difference = Extract<
  RecipeScope,
  { kind: 'changed' }
>['differences'][number];
type Field = Extract<Difference, { change: 'altered' }>['fields'][number];

// How the checks of one captured journey are judged.
export type JourneyJudgement =
  // No base observed.json to compare with: the captured definitions judge.
  | { kind: 'not-compared' }
  // The base defines no such journey, or has no usable observed.json.
  | { kind: 'added' }
  // `fields` names the journey fields that differ; any makes every check in
  // the journey unknown.
  | {
      kind: 'compared';
      base: readonly CheckDefinition[];
      fields: readonly string[];
    };

export type RecipePlan = {
  scope: RecipeScope;
  judge: (journey: string) => JourneyJudgement;
  removed: readonly { journey: string; checks: readonly CheckDefinition[] }[];
};

// The fields that decide what a capture does, with the defaults a capture
// applies, so an omitted default is not a difference.
function journeyFields(journey: Journey): Record<string, unknown> {
  return {
    path: journey.path,
    ready: journey.ready,
    steps: journey.steps,
    collectors: journey.collectors ?? [],
    viewport: journey.viewport ?? defaultViewport,
    browserArguments: journey.browserArguments ?? [],
    allowedOrigins: journey.allowedOrigins ?? null,
    maxAgeMs: journey.maxAgeMs ?? defaultMaxAgeMs,
  };
}

function jsonValue(value: unknown): Field['base'] {
  // Decoded observed.json values are JSON already; this drops readonly
  // markers and turns an absent field into null.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return JSON.parse(JSON.stringify(value ?? null)) as Field['base'];
}

function fieldDifferences(
  base: Readonly<Record<string, unknown>>,
  candidate: Readonly<Record<string, unknown>>,
): Field[] {
  const keys = [...new Set([...Object.keys(base), ...Object.keys(candidate)])];

  return keys
    .filter(
      (key) => !isDeepStrictEqual(base[key] ?? null, candidate[key] ?? null),
    )
    .map((key) => ({
      field: key,
      base: jsonValue(base[key]),
      candidate: jsonValue(candidate[key]),
    }));
}

function checkDifferences(base: Journey, candidate: Journey): Difference[] {
  const before = journeyChecks(base);
  const after = journeyChecks(candidate);
  const differences: Difference[] = [];

  for (const check of after) {
    const previous = before.find((item) => item.id === check.id);
    const fields =
      previous === undefined ? [] : fieldDifferences(previous, check);
    const [first, ...rest] = fields;

    if (previous === undefined) {
      differences.push({
        journey: candidate.name,
        check: check.id,
        change: 'added',
      });
    } else if (first !== undefined) {
      differences.push({
        journey: candidate.name,
        check: check.id,
        change: 'altered',
        fields: [first, ...rest],
      });
    }
  }

  for (const check of before) {
    if (!after.some((item) => item.id === check.id)) {
      differences.push({
        journey: candidate.name,
        check: check.id,
        change: 'removed',
      });
    }
  }

  return differences;
}

const notCompared = (reason: string): RecipePlan => ({
  scope: { kind: 'unavailable', reason },
  judge: () => ({ kind: 'not-compared' }),
  removed: [],
});

// Compares the base and candidate observed.json by journey name and check ID.
// Key order and whitespace never reach this point, since both files are
// parsed first.
export function recipePlan(
  sources: RecipeSources | undefined,
  missingReason: string,
): RecipePlan {
  if (sources === undefined) {
    return notCompared(missingReason);
  }

  const { base, candidate } = sources;

  if (base.kind === 'unavailable') {
    return notCompared(base.reason);
  }

  if (base.kind === 'unusable') {
    const [first, ...rest] = candidate;

    return {
      scope: {
        kind: 'changed',
        base: { kind: 'unusable', reason: base.reason },
        differences: [
          { journey: first.name, change: 'added' },
          ...rest.map((journey) => ({
            journey: journey.name,
            change: 'added' as const,
          })),
        ],
      },
      judge: () => ({ kind: 'added' }),
      removed: [],
    };
  }

  const differences: Difference[] = [];

  for (const journey of candidate) {
    const previous = base.journeys.find((item) => item.name === journey.name);

    if (previous === undefined) {
      differences.push({ journey: journey.name, change: 'added' });
      continue;
    }

    const [first, ...rest] = fieldDifferences(
      journeyFields(previous),
      journeyFields(journey),
    );

    if (first !== undefined) {
      differences.push({
        journey: journey.name,
        change: 'altered',
        fields: [first, ...rest],
      });
    }

    differences.push(...checkDifferences(previous, journey));
  }

  const removed = base.journeys.filter(
    (journey) => !candidate.some((item) => item.name === journey.name),
  );

  differences.push(
    ...removed.map((journey) => ({
      journey: journey.name,
      change: 'removed' as const,
    })),
  );

  const [first, ...rest] = differences;

  return {
    scope:
      first === undefined
        ? { kind: 'unchanged' }
        : {
            kind: 'changed',
            base: { kind: 'read' },
            differences: [first, ...rest],
          },
    judge: (name) => {
      const after = candidate.find((item) => item.name === name);
      const before = base.journeys.find((item) => item.name === name);

      if (after === undefined) {
        return { kind: 'not-compared' };
      }

      return before === undefined
        ? { kind: 'added' }
        : {
            kind: 'compared',
            base: journeyChecks(before),
            fields: fieldDifferences(
              journeyFields(before),
              journeyFields(after),
            ).map((item) => item.field),
          };
    },
    removed: removed.map((journey) => ({
      journey: journey.name,
      checks: journeyChecks(journey),
    })),
  };
}
