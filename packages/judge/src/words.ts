import { importedAuthority } from './checks/playwright';
import type {
  Check,
  CheckVerdict,
  Comparison,
  Conclusion,
  Journey,
  Proposed,
  Side,
} from './result';
import { everyCaptureFailed, proposedOf } from './result';

// Sentences for verdicts the judge already decided. Nothing here changes a
// verdict.

// Keeps a conclusion about a large imported suite short enough to deliver.
// The report still lists every check.
const listedChecks = 10;

export function listed(values: readonly string[]): string {
  return values.length <= 1
    ? values.join('')
    : `${values.slice(0, -1).join(', ')} and ${values.at(-1) ?? ''}`;
}

export function describeActual(check: Check | undefined): string {
  return check === undefined || check.actual === null ? 'unknown' : String(check.actual);
}

export function names(verdicts: readonly { name: string }[]): string {
  const shown = verdicts.slice(0, listedChecks).map((verdict) => verdict.name);
  const hidden = verdicts.length - shown.length;

  return hidden > 0 ? `${shown.join(', ')} and ${hidden} more` : shown.join(', ');
}

function sentences(parts: readonly string[], rest: (count: number) => string): string {
  const hidden = parts.length - listedChecks;

  return [...parts.slice(0, listedChecks), ...(hidden > 0 ? [rest(hidden)] : [])].join(' ');
}

export const unreadableBaseDetail = (reason: string): string =>
  `The base revision's observed.json could not be read, so no check can be judged. ${reason}`;

export const journeyAlteredDetail = (fields: readonly string[]): string =>
  `This change alters the journey's ${listed(fields)}, so the captures cannot apply the base's checks.`;

export const removedJourneyDetail =
  'This change removes the journey, so no capture ran this check.';

export function regressionDetail(before: Check, after: Check, expectation: string): string {
  return `${after.name} passed on base and failed on candidate. Base: ${describeActual(before)}; candidate: ${describeActual(after)}. ${expectation}`;
}

const proposedOutcomes = {
  passed: 'passed',
  failed: 'failed',
  unknown: 'is unknown',
  'not-run': 'did not run',
} satisfies Record<Proposed['outcome'], string>;

export const addedText = 'This change adds the check, so it has no baseline.';

function recipeNote({ recipe, verdict }: CheckVerdict): string {
  const proposal = proposedOf(recipe);

  switch (recipe?.change) {
    case undefined:
    case 'added':
      return '';
    case 'altered':
    case 'journey-altered':
      return proposal === undefined
        ? ''
        : ` The candidate's proposed version ${proposedOutcomes[proposal.outcome]} and sets no verdict.`;
    case 'removed':
      return verdict === 'unknown'
        ? ''
        : " This change removes the check, so the base's definition judged both captures.";
    case 'test-file-changed':
      return verdict === 'passed' ? ' This change alters its test file.' : '';
    default:
      return recipe satisfies never;
  }
}

function notComparedLead(base: Side, candidate: Side): string {
  const baseFailed = base.execution === 'capture-failed';
  const candidateFailed = candidate.execution === 'capture-failed';

  if (baseFailed && candidateFailed) {
    return 'Both captures failed, so the revisions were not compared.';
  }

  if (baseFailed || candidateFailed) {
    return `The ${baseFailed ? 'base' : 'candidate'} capture failed, so the revisions were not compared.`;
  }

  return 'The revisions were not compared.';
}

function regressionText(regressions: readonly CheckVerdict[]): string {
  return sentences(
    regressions.map((item) => `${item.detail}${recipeNote(item)}`),
    (count) => `${count} more ${count === 1 ? 'check' : 'checks'} regressed.`,
  );
}

function failedText(
  failed: readonly CheckVerdict[],
  { base, candidate, comparison, mode }: JourneyParts,
): string {
  const baseCheck = (id: string) => base.checks.find((check) => check.id === id);
  const candidateCheck = (id: string) => candidate.checks.find((check) => check.id === id);

  return sentences(
    failed.map((item) => {
      const after = candidateCheck(item.id);

      if (mode === 'preview') {
        return `${item.name}: failed.`;
      }

      if (item.recipe?.change === 'added') {
        return `${item.name} failed. ${addedText} Candidate: ${describeActual(after)}. ${item.expectation}`;
      }

      if (comparison.kind !== 'available') {
        return `${item.name} failed. The revisions were not compared, so a regression cannot be established. Candidate: ${describeActual(after)}. ${item.expectation}${recipeNote(item)}`;
      }

      const readings = {
        failed: 'Base also failed, so a regression is not established.',
        passed: "Base passed, but the check's regression rule did not establish a regression.",
        'not-run': 'Base was not run, so a regression cannot be established.',
        unknown: 'Base was unknown, so a regression cannot be established.',
      } as const;
      const before = baseCheck(item.id);
      const reading = readings[before?.outcome ?? 'unknown'];

      // An imported check's detail says why no regression was established
      // when base passed or had no result.
      if (after?.authority === importedAuthority) {
        return `${item.name} failed. ${before === undefined || before.outcome === 'passed' ? '' : `${reading} `}${item.detail}`;
      }

      return `${item.name} failed. ${reading} Base: ${describeActual(before)}; candidate: ${describeActual(after)}. ${item.expectation}${recipeNote(item)}`;
    }),
    (count) => `${count} more ${count === 1 ? 'check' : 'checks'} failed.`,
  );
}

type JourneyParts = Pick<Journey, 'base' | 'candidate' | 'checks' | 'comparison'> & {
  mode: Comparison['mode'];
};

// The sentence for a journey conclusion. `kind` comes from the judge.
export function journeyConclusionText(kind: Conclusion['kind'], parts: JourneyParts): string {
  const { base, candidate, checks: verdicts, comparison, mode } = parts;
  const by = (verdict: CheckVerdict['verdict']) =>
    verdicts.filter((item) => item.verdict === verdict);
  const passed = by('passed');
  const unknown = by('unknown');
  const notRun = by('not-run');
  const notRunText = notRun.length === 0 ? '' : ` Not run: ${names(notRun)}.`;
  const baseOutcome = (id: string) =>
    ({
      passed: 'passed',
      failed: 'failed',
      'not-run': 'was not run',
      unknown: 'was unknown',
    })[base.checks.find((check) => check.id === id)?.outcome ?? 'unknown'];

  switch (kind) {
    case 'regression':
      return regressionText(by('regression'));
    case 'check-failed':
      return failedText(by('failed'), parts);
    case 'unavailable': {
      if (mode === 'preview' && candidate.execution !== 'complete') {
        return candidate.execution === 'capture-failed'
          ? 'The capture failed. Nothing was checked.'
          : 'The capture is unavailable. Nothing was checked.';
      }

      if (comparison.kind === 'unavailable') {
        const lead = notComparedLead(base, candidate);

        return unknown.length > 0
          ? `${lead} Unknown: ${names(unknown)}.`
          : `${lead}${verdicts.length === 0 ? '' : ` ${passed.length} of ${verdicts.length} candidate checks passed.`}${notRunText}`;
      }

      return sentences(
        unknown.map((item) => `${item.name}: unknown. ${item.detail}${recipeNote(item)}`),
        (count) => `${count} more ${count === 1 ? 'check is' : 'checks are'} unknown.`,
      ).concat(notRunText);
    }
    case 'preview':
      return passed.length === 0
        ? `Current application capture.${notRunText}`
        : `${sentences(
            passed.map((item) => `${item.name}: passed.`),
            (count) => `${count} more ${count === 1 ? 'check' : 'checks'} passed.`,
          )}${notRunText}`;
    case 'not-checked':
      return notRun.length === 0
        ? 'Before and after captured. No named check is configured, so no behavior was checked.'
        : `Before and after captured. No named check ran, so no behavior was checked.${notRunText}`;
    case 'no-regression':
      return sentences(
        passed.map((item) => {
          if (item.recipe?.change === 'added') {
            return `${item.name} passed on the candidate. ${addedText}`;
          }

          return baseOutcome(item.id) === 'passed'
            ? `${item.name} passed on base and candidate.${recipeNote(item)}`
            : `${item.name} ${baseOutcome(item.id)} on base and passed on candidate.${recipeNote(item)}`;
        }),
        (count) => `${count} more ${count === 1 ? 'check' : 'checks'} passed on the candidate.`,
      ).concat(notRunText);
    default:
      return kind satisfies never;
  }
}

function observedSourceNotes(base: Side, candidate: Side): string[] {
  const before = base.capture?.manifest.observed;
  const after = candidate.capture?.manifest.observed;

  if (before === undefined || after === undefined || before.version !== after.version) {
    return [];
  }

  const sides = [
    { name: 'base', source: before.source },
    { name: 'candidate', source: after.source },
  ] as const;
  const notes: string[] = [];
  const unknown = sides.flatMap(({ name, source }) =>
    source.kind === 'unavailable' ? [{ name, reason: source.reason }] : [],
  );

  const [first, second] = unknown;

  if (first !== undefined) {
    const subject = second === undefined ? `the ${first.name} capture` : 'both captures';

    notes.push(
      `Observed's source commit is unknown for ${subject}, so the same Observed ${after.version} code cannot be confirmed on both sides. ${second !== undefined && first.reason === second.reason ? `Both: ${first.reason}` : unknown.map(({ name, reason }) => `${name}: ${reason}`).join('; ')}.`,
    );
  } else if (
    before.source.kind === 'git' &&
    after.source.kind === 'git' &&
    before.source.commit !== after.source.commit
  ) {
    notes.push(
      `Both captures report Observed ${after.version}, but from different commits (base ${before.source.commit}, candidate ${after.source.commit}), so the observations may come from different code.`,
    );
  }

  for (const side of sides) {
    if (side.source.kind === 'git' && side.source.trackedChanges) {
      notes.push(
        `The ${side.name} capture ran Observed ${after.version} with uncommitted tracked changes, so commit ${side.source.commit} does not identify its code.`,
      );
    }
  }

  return notes;
}

export function journeyLimitations({
  base,
  candidate,
  generated,
  mode,
}: Pick<Journey, 'base' | 'candidate' | 'generated'> & {
  mode: Comparison['mode'];
}): string[] {
  return [
    ...(generated === undefined
      ? []
      : [
          'Generated journey: agent interpretation. Only executed baseline checks set verdicts; other differences remain observations.',
        ]),
    'Checks cover only their stated expectations and scopes. Browser errors remain available as evidence.',
    'Screenshot differences are observations of rendered pixels, not a visual regression.',
    'Artifact hashes detect changed bytes; they do not establish collector honesty or source causation.',
    ...(mode === 'comparison' ? observedSourceNotes(base, candidate) : []),
  ];
}

export const comparedBasis =
  'Complete, intact captures with the same protected recipe, application, producer, Observed version, and recorded conditions.';

export const redefinedBasis =
  "Complete, intact captures of the candidate's journey, with the same application, producer, Observed version, and recorded conditions. The base's observed.json defines this journey differently.";

export function runConclusionText({
  journeys,
  kind,
  mode,
  removedJourneys,
}: Pick<Comparison, 'journeys' | 'mode' | 'removedJourneys'> & {
  kind: Conclusion['kind'];
}): string {
  const [first] = journeys;
  const deciding = journeys.filter((journey) => journey.conclusion.kind === kind);
  let lead: string;

  if (journeys.length === 1) {
    lead = first.conclusion.text;
  } else if (everyCaptureFailed(journeys, mode)) {
    const unknown = journeys
      .flatMap((journey) => journey.checks)
      .filter((item) => item.verdict === 'unknown').length;
    const checks =
      unknown === 0 ? '' : ` ${unknown} ${unknown === 1 ? 'check is' : 'checks are'} unknown.`;

    lead = `Every capture failed, so no journey was ${mode === 'preview' ? 'checked' : 'compared'}.${checks}`;
  } else {
    lead = deciding.map((journey) => `${journey.title}: ${journey.conclusion.text}`).join(' ');
  }

  const removed = removedJourneys
    .filter((journey) => journey.checks.length > 0)
    .map(
      (journey) =>
        `${journey.journey}: this change removes the journey, so no capture ran its checks. Unknown: ${names(journey.checks)}.`,
    );

  return [lead, ...removed].filter((part) => part !== '').join(' ');
}
