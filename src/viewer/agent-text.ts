import type { Comparison, Journey, Side } from '../comparison-model';
import { describeRevision } from '../provenance-text';
import {
  anchorLocation,
  conclusionLabels,
  describeMeasure,
  verdictLabels,
} from '../result-text';

const agentArtifacts = new Set([
  'recipe',
  'observations',
  'requests',
  'errors',
  'console',
  'screenshot',
]);

function identity(label: string, side: Side): string {
  const capture = side.capture?.manifest ?? null;

  if (capture === null) {
    return `${label}: capture unavailable`;
  }

  const name = capture.label === label ? '' : `${capture.label}, `;

  return `${label}: ${name}${describeRevision(capture.source.revision)}, snapshot ${capture.source.sha256}`;
}

function files(label: string, side: Side): string[] {
  return side.artifacts.flatMap((artifact) =>
    artifact.integrity === 'verified' &&
    (agentArtifacts.has(artifact.id) || artifact.id.startsWith('evidence-'))
      ? [`- ${label}: ${artifact.path} (${artifact.description})`]
      : [],
  );
}

function journeyText(
  journey: Journey,
  mode: Comparison['mode'],
  conclusion: string,
): string[] {
  const sides =
    mode === 'preview'
      ? [{ label: 'Capture', side: journey.candidate }]
      : [
          { label: 'Base', side: journey.base },
          { label: 'Candidate', side: journey.candidate },
        ];
  const unresolved = sides.flatMap(({ label, side }) =>
    side.unresolved.map((reason) => `- ${label}: ${reason}`),
  );
  const visual =
    journey.comparison.kind === 'available' &&
    journey.comparison.visual.kind === 'changed'
      ? [`- Pixel difference: ${journey.comparison.visual.diff.path}`]
      : [];

  return [
    ...sides.map(({ label, side }) => identity(label, side)),
    '',
    '### Checks',
    ...(journey.checks.length === 0
      ? ['No named checks are configured, so nothing was verified.']
      : journey.checks.map((check) => {
          const location = anchorLocation(journey, check);
          const measure =
            check.measure === undefined
              ? null
              : describeMeasure(check.measure, mode);

          return `- ${verdictLabels[check.verdict]}: ${check.name}.${measure === null || check.detail.includes(measure) ? '' : ` ${measure}.`}${check.detail === conclusion ? '' : ` ${check.detail}`} Scope: ${check.scope}${location === null ? '' : ` Location: ${location.words} ${location.place}.`}`;
        })),
    ...(unresolved.length === 0 ? [] : ['', '### Unresolved', ...unresolved]),
    ...(journey.comparison.kind === 'unavailable'
      ? [
          '',
          '### Comparison unavailable',
          ...journey.comparison.reasons.map((reason) => `- ${reason}`),
        ]
      : []),
    '',
    '### Evidence files',
    ...sides.flatMap(({ label, side }) => files(label, side)),
    ...visual,
    '',
    '### Limits',
    ...journey.limitations.map((limit) => `- ${limit}`),
  ];
}

// Deterministic text for a coding agent: the verdict, identities, checks and
// the bundle files that hold the raw evidence. It never adds a suggestion.
export function agentText(result: Comparison): string {
  const multiple = result.journeys.length > 1;

  return [
    `## Observed: ${conclusionLabels[result.conclusion.kind]} · ${result.title}`,
    '',
    result.conclusion.text,
    '',
    `Evaluated at ${result.evaluatedAt}. Paths are relative to the report directory, next to result.json, which holds the full result.`,
    '',
    ...result.journeys.flatMap((journey) => [
      ...(multiple
        ? [`## ${journey.title}`, '', journey.conclusion.text, '']
        : []),
      ...journeyText(journey, result.mode, result.conclusion.text),
      '',
    ]),
    'A changed value is not a regression by itself; verify against the artifacts before changing code.',
    '',
  ].join('\n');
}
