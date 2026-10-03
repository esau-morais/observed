import type { Comparison, Journey, Side } from '../comparison-model';
import { describeRevision } from '../provenance-text';
import {
  anchorLocation,
  runLabel,
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
  level: string,
): string[] {
  const sides =
    mode === 'preview'
      ? [{ label: 'Capture', side: journey.candidate }]
      : [
          { label: 'Base', side: journey.base },
          { label: 'Candidate', side: journey.candidate },
        ];
  const labels = new Map<string, string[]>();

  for (const { label, side } of sides) {
    for (const reason of side.unresolved) {
      labels.set(reason, [...(labels.get(reason) ?? []), label]);
    }
  }

  const unresolved = [...labels].map(
    ([reason, named]) => `- ${named.join(' and ')}: ${reason}`,
  );
  const restated = (text: string) =>
    [...labels.keys()].some((reason) => text.endsWith(reason));
  const reasons =
    journey.comparison.kind === 'unavailable'
      ? journey.comparison.reasons.filter((reason) => !restated(reason))
      : [];
  const visual =
    journey.comparison.kind === 'available' &&
    journey.comparison.visual.kind === 'changed'
      ? [`- Pixel difference: ${journey.comparison.visual.diff.path}`]
      : [];

  return [
    ...sides.map(({ label, side }) => identity(label, side)),
    '',
    `${level} Checks`,
    ...(journey.checks.length === 0
      ? ['No named check is configured, so no behavior was checked.']
      : journey.checks.map((check) => {
          const location = anchorLocation(journey, check);
          const measure =
            check.measure === undefined
              ? null
              : describeMeasure(check.measure, mode);

          return `- ${verdictLabels[check.verdict]}: ${check.name}.${measure === null || check.detail.includes(measure) ? '' : ` ${measure}.`}${check.detail === conclusion || labels.has(check.detail) ? '' : ` ${check.detail}`} Scope: ${check.scope}${location === null ? '' : ` Location: ${location.words} ${location.place}.`}`;
        })),
    ...(unresolved.length === 0
      ? []
      : ['', `${level} Unresolved`, ...unresolved]),
    ...(journey.comparison.kind === 'unavailable'
      ? [
          '',
          `${level} Comparison unavailable`,
          ...(reasons.length === 0
            ? ['- Because of the unresolved evidence above.']
            : reasons.map((reason) => `- ${reason}`)),
        ]
      : []),
    '',
    `${level} Evidence files`,
    ...sides.flatMap(({ label, side }) => files(label, side)),
    ...visual,
    '',
    `${level} Limits`,
    ...journey.limitations.map((limit) => `- ${limit}`),
  ];
}

// Deterministic text for a coding agent: the facts first, then the next
// steps, one instruction each. It never adds a suggestion about the code.
export function agentText(result: Comparison): string {
  const multiple = result.journeys.length > 1;

  return [
    `## Observed: ${runLabel(result)} · ${result.title}`,
    '',
    '### Facts',
    '',
    result.conclusion.text,
    '',
    `Evaluated at ${result.evaluatedAt}. Paths are relative to the report directory. result.json in that directory holds the full result.`,
    '',
    ...result.journeys.flatMap((journey) => [
      ...(multiple
        ? [`#### ${journey.title}`, '', journey.conclusion.text, '']
        : []),
      ...journeyText(
        journey,
        result.mode,
        result.conclusion.text,
        multiple ? '#####' : '####',
      ),
      '',
    ]),
    'A changed value is not a regression by itself.',
    '',
    '### Next steps',
    '',
    '- Read result.json and the evidence files listed above.',
    '- Compare each value with its artifact before you change code.',
    '- Name the evidence that your change addresses.',
    '',
  ].join('\n');
}
