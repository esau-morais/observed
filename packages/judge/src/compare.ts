import { judgeJourney, runConclusionKind, type Mode } from './judge';
import type { Comparison, Journey, RecipeScope } from './result';
import { resultSchemaVersion, runVerdicts } from './result';
import { journeyConclusionText, journeyLimitations, runConclusionText } from './words';

// Joins the judge's verdicts with their sentences into the result people
// read. The words never change a verdict.

export function compareJourney(options: Parameters<typeof judgeJourney>[0]): Journey {
  const judged = judgeJourney(options);
  const mode = options.mode ?? 'comparison';

  return {
    ...judged,
    conclusion: {
      kind: judged.conclusion.kind,
      text: journeyConclusionText(judged.conclusion.kind, { ...judged, mode }),
    },
    limitations: journeyLimitations({ ...judged, mode }),
  };
}

export const notComparedReason =
  'observed.json was not read from the base revision, because this comparison was made from capture directories';

const notComparedRecipe: RecipeScope = {
  kind: 'unavailable',
  reason: notComparedReason,
};

export function summarizeJourneys({
  journeys,
  evaluatedAt,
  mode,
  recipe = notComparedRecipe,
  removedJourneys = [],
}: {
  journeys: readonly [Journey, ...Journey[]];
  evaluatedAt: string;
  mode: Mode;
  recipe?: RecipeScope;
  removedJourneys?: Comparison['removedJourneys'];
}): Comparison {
  const [first] = journeys;
  const kind = runConclusionKind({ journeys, removedJourneys });
  const verdicts = runVerdicts({ journeys, removedJourneys });

  return {
    schemaVersion: resultSchemaVersion,
    mode,
    title:
      journeys.length === 1
        ? first.title
        : (first.candidate.capture?.manifest.application ?? `${journeys.length} journeys`),
    evaluatedAt,
    journeys,
    summary: {
      passed: verdicts.filter((item) => item.verdict === 'passed').length,
      total: verdicts.length,
    },
    conclusion: {
      kind,
      text: runConclusionText({ journeys, kind, mode, removedJourneys }),
    },
    recipe,
    removedJourneys,
  };
}

export function compareCaptures(options: Parameters<typeof judgeJourney>[0]): Comparison {
  return summarizeJourneys({
    journeys: [compareJourney(options)],
    evaluatedAt: options.evaluatedAt,
    mode: options.mode ?? 'comparison',
  });
}
