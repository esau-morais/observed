import { savingProposalText } from './generated-proposals';
import {
  capturedFiles,
  relationLabels,
  recipeLabels,
  recipeLine,
  recipeLines,
  repositoryPath,
  scopeLine,
  scopeNotes,
} from './change-scope-text';
import { escapeText, link } from './markdown';
import {
  checkLabels,
  checkSummary,
  conclusionLabels,
  executionLabels,
  integrityLabels,
  runLabel,
  unobservedAfterPassing,
  unobservedText,
  verdictLabels,
} from './result-text';
import type {
  Check,
  CheckVerdict,
  Comparison,
  Journey,
  Side,
  Visual,
} from './comparison-model';
import { evidenceKinds } from './evidence-kinds';
import { statusWords } from './status-words';
import { journeySections, renderMarkdownSection } from './report-sections';
import { describeObserved, describeRevision } from './provenance-text';
import { describeStatus } from './request-text';
import {
  changedShare,
  describeRegion,
  describeVisual,
  diffLegend,
} from './visual-text';

function heading(level: number, text: string): string {
  return `${'#'.repeat(level)} ${text}`;
}

function list(values: readonly string[]): string {
  return values.map((value) => `- ${escapeText(value)}`).join('\n');
}

// A summary is HTML, so Markdown escapes would show in it.
function collapsed(summary: string, body: readonly string[]): string {
  return [
    `<details><summary>${summary.replace(/[&<>]/g, (character) => `&#${character.charCodeAt(0)};`)}</summary>`,
    ...body,
    '</details>',
  ].join('\n\n');
}

function renderIdentity(side: Side, label: string, level: number): string {
  if (side.capture === null) {
    return `${heading(level, label)}\n\nCapture unavailable.\n\nCapture: ${executionLabels[side.execution]}.`;
  }

  const capture = side.capture.manifest;

  return [
    heading(level, label),
    `- Label: ${escapeText(capture.label)}`,
    `- Full snapshot SHA-256: ${escapeText(capture.source.sha256)}`,
    `- Capture started (UTC): ${escapeText(capture.startedAt)}`,
    `- Capture finished (UTC): ${escapeText(capture.finishedAt)}`,
    `- Capture: ${executionLabels[side.execution]}`,
  ].join('\n\n');
}

function renderVerdict(verdict: CheckVerdict): string {
  return [
    `- **${verdictLabels[verdict.verdict]}**: ${escapeText(verdict.name)}${verdict.recipe === undefined ? '' : ` · ${recipeLabels[verdict.recipe.change]}`}`,
    `  - Scope: ${escapeText(verdict.scope)}`,
    `  - ${escapeText(verdict.detail)}`,
  ].join('\n');
}

function renderChecks(side: Side, label: string, level: number): string {
  if (side.checks.length === 0) {
    return `${heading(level, label)}\n\nNo named check configured.`;
  }

  return side.checks
    .map((check) => renderCheck(check, label, level))
    .join('\n\n');
}

function renderCheck(check: Check, label: string, level: number): string {
  return [
    heading(level, `${label}: ${escapeText(check.name)}`),
    `**${checkLabels[check.outcome]}** · ${escapeText(check.authority)}`,
    escapeText(check.detail),
    [
      `- Expectation: ${escapeText(check.expectation)}`,
      `- Scope: ${escapeText(check.scope)}`,
      `- Actual: ${check.actual === null ? 'Unknown' : escapeText(String(check.actual))}`,
      `- Check ID: ${escapeText(check.id)}`,
    ].join('\n'),
  ].join('\n\n');
}

function renderVisual(visual: Visual): string {
  const summary = escapeText(describeVisual(visual));

  if (visual.kind !== 'changed') {
    return summary;
  }

  return [
    `${summary} ${link('Open pixel difference image', visual.diff.path)} (SHA-256 ${visual.diff.sha256}). ${escapeText(diffLegend)}`,
    ...visual.regions.map((box) => `  - ${escapeText(describeRegion(box))}`),
  ].join('\n');
}

function image(label: string, side: Side): string {
  return side.screenshot === null
    ? 'Screenshot unavailable'
    : `!${link(`${label} captured application`, side.screenshot)}`;
}

function screenshotLinks(journey: Journey): string {
  return [
    { name: 'before', path: journey.base.screenshot },
    { name: 'after', path: journey.candidate.screenshot },
  ]
    .map(({ name, path }) =>
      path === null
        ? `The ${name} screenshot is unavailable`
        : link(`Open the ${name} screenshot`, path),
    )
    .join(' · ');
}

function renderScreens(journey: Journey, level: number): string[] {
  const comparison = journey.comparison;

  if (comparison.kind === 'preview') {
    return [heading(level, 'Screenshot'), image('Current', journey.candidate)];
  }

  if (comparison.kind === 'unavailable') {
    return [screenshotLinks(journey)];
  }

  const visual = comparison.visual;

  if (visual.kind === 'changed') {
    return [
      heading(level, 'What changed on screen'),
      `${escapeText(changedShare(visual))} An observation, not a check.`,
      [
        '| Before | After | Changed pixels |',
        '| --- | --- | --- |',
        `| ${image('Before', journey.base)} | ${image('After', journey.candidate)} | !${link('Changed pixels', visual.diff.path)} |`,
      ].join('\n'),
      escapeText(diffLegend),
    ];
  }

  if (visual.kind === 'size-differs') {
    return [
      heading(level, 'What changed on screen'),
      escapeText(describeVisual(visual)),
      [
        '| Before | After |',
        '| --- | --- |',
        `| ${image('Before', journey.base)} | ${image('After', journey.candidate)} |`,
      ].join('\n'),
    ];
  }

  return [
    heading(level, 'Screenshots'),
    escapeText(describeVisual(visual)),
    screenshotLinks(journey),
  ];
}

function renderAvailability(journey: Journey): string {
  const comparison = journey.comparison;

  if (comparison.kind === 'preview') {
    return 'Single capture. No comparison requested.';
  }

  if (comparison.kind === 'unavailable') {
    return `Unavailable.\n\n${list(comparison.reasons)}`;
  }

  return [
    `Available. ${escapeText(comparison.basis)}`,
    `- Request count difference (candidate minus base): ${comparison.requestDifference}`,
    `- Screenshot pixels: ${renderVisual(comparison.visual)}`,
  ].join('\n\n');
}

function renderLedger(side: Side, label: string, level: number): string {
  if (side.execution !== 'complete') {
    return `${heading(level, label)}\n\nRequest evidence unavailable.`;
  }

  const observations = side.observations;

  const requests =
    observations.requests.length === 0
      ? 'No requests recorded in this window.'
      : [
          '| Method | Path | Status | Timestamp (UTC) |',
          '| --- | --- | --- | --- |',
          ...observations.requests.map(
            (request) =>
              `| ${escapeText(request.method)} | ${escapeText(`${request.origin === 'application' ? '' : request.origin}${request.path}`)} | ${describeStatus(request.status)} | ${escapeText(request.startedAt)} |`,
          ),
        ].join('\n');

  const errors =
    observations.browserErrors.length === 0
      ? 'No browser errors recorded during capture.'
      : `Recorded browser errors:\n\n${list(observations.browserErrors)}`;

  return [
    heading(level, label),
    `Recorded window: ${escapeText(observations.window.startedAt)} to ${escapeText(observations.window.finishedAt)}.`,
    requests,
    errors,
  ].join('\n\n');
}

function renderArtifacts(side: Side, label: string, level: number): string {
  const artifacts = side.artifacts.map((artifact) => {
    const reference =
      artifact.integrity === 'verified'
        ? link(artifact.id, artifact.path)
        : escapeText(artifact.id);

    const reason =
      artifact.integrity === 'verified'
        ? ''
        : ` ${escapeText(artifact.reason)}`;

    return `- ${reference}: ${escapeText(artifact.description)}\n  - Artifact integrity: ${integrityLabels[artifact.integrity]}.${reason}`;
  });

  const screenshot =
    side.screenshot === null
      ? 'Screenshot unavailable.'
      : link(
          `Open ${label.toLowerCase()} screenshot at full size`,
          side.screenshot,
        );

  return [
    heading(level, label),
    screenshot,
    artifacts.length === 0 ? 'No artifacts available.' : artifacts.join('\n'),
  ].join('\n\n');
}

function renderProvenance(side: Side, label: string, level: number): string {
  if (side.capture === null) {
    return `${heading(level, label)}\n\nCapture metadata unavailable.`;
  }

  const capture = side.capture.manifest;

  const conditions = capture.conditions;
  let recordedConditions: string;

  if (conditions.kind === 'unavailable') {
    recordedConditions = `- Conditions unavailable: ${escapeText(conditions.reason)}`;
  } else {
    const value = conditions.value;

    recordedConditions = [
      `- Browser: ${escapeText(value.browser)}`,
      `- Platform: ${escapeText(value.platform)}`,
      `- Bun: ${escapeText(value.bun)}`,
      `- Viewport: ${value.viewport.width} × ${value.viewport.height} CSS px; scale ${value.viewport.scale}`,
      `- Color scheme: ${value.colorScheme}`,
      `- Locale: ${escapeText(value.locale)}`,
      `- Timezone: ${escapeText(value.timezone)}`,
      `- Startup inputs SHA-256: ${escapeText(value.inputsHash)}`,
      `- Dependency files SHA-256: ${escapeText(value.dependenciesHash ?? 'No dependency files selected')}`,
    ].join('\n');
  }

  const failure =
    capture.execution.kind === 'failed'
      ? `- Capture failure: ${capture.execution.category}: ${escapeText(capture.execution.reason)}`
      : '';

  return [
    heading(level, label),
    [
      `- Application: ${escapeText(capture.application)}`,
      `- Capture ID: ${escapeText(capture.id)}`,
      `- Manifest SHA-256: ${side.capture.sha256}`,
      `- Producer: ${escapeText(capture.producer.name)}; version ${escapeText(capture.producer.version)}`,
      `- Observed: version ${escapeText(describeObserved(capture.observed))}`,
      `- Source revision: ${escapeText(describeRevision(capture.source.revision))}`,
      `- Recipe: ${escapeText(capture.recipe.id)}`,
      `- Recipe SHA-256: ${escapeText(capture.recipe.sha256)}`,
      `- Source entry: ${escapeText(capture.source.entry)}`,
      failure,
      recordedConditions,
    ]
      .filter((line) => line !== '')
      .join('\n'),
    'Source files:',
    capture.source.files
      .map(
        (file) =>
          `- ${escapeText(file.path)}\n  - SHA-256: ${escapeText(file.sha256)}`,
      )
      .join('\n'),
  ].join('\n\n');
}

function renderJourney(
  result: Comparison,
  journey: Journey,
  level: number,
): { lead: string[]; details: string[] } {
  const preview = result.mode === 'preview';
  const candidateLabel = preview ? 'Current capture' : 'Candidate · after';
  const sides = (render: (side: Side, label: string) => string) => [
    ...(preview ? [] : [render(journey.base, 'Base · before')]),
    render(journey.candidate, candidateLabel),
  ];
  const shared = new Set(
    preview
      ? []
      : journey.base.unresolved.filter((reason) =>
          journey.candidate.unresolved.includes(reason),
        ),
  );
  const unresolved = [
    ...[...shared].map((reason) => `Base and candidate: ${reason}`),
    ...(preview
      ? []
      : journey.base.unresolved
          .filter((reason) => !shared.has(reason))
          .map((reason) => `Base: ${reason}`)),
    ...journey.candidate.unresolved
      .filter((reason) => !shared.has(reason))
      .map((reason) => `Candidate: ${reason}`),
    ...journey.limitations,
  ];
  const single = result.journeys.length === 1;
  const comparison = journey.comparison;

  return {
    lead: [
      ...(journey.generated === undefined
        ? []
        : [
            `Generated journey · Agent interpretation. ${escapeText(journey.generated.reason)} Only executed baseline checks set verdicts. ${savingProposalText(journey)}`,
          ]),
      ...(single
        ? []
        : [
            `**${conclusionLabels[journey.conclusion.kind]}** · ${escapeText(journey.conclusion.text)}`,
          ]),
      ...(comparison.kind === 'unavailable'
        ? [
            heading(
              level,
              `Comparison ${statusWords.unavailable.word.toLowerCase()}`,
            ),
            list(comparison.reasons),
          ]
        : []),
      ...renderScreens(journey, level),
      heading(level, 'Checks'),
      journey.checks.length === 0
        ? 'No named check configured.'
        : journey.checks.map(renderVerdict).join('\n'),
      heading(level, 'Unresolved evidence and limits'),
      unresolved.length === 0
        ? 'No unresolved items reported. Coverage is limited to the named checks and recorded capture windows.'
        : list(unresolved),
    ],
    details: [
      collapsed(
        preview
          ? 'Each check on the current capture'
          : 'Each check on base and candidate',
        [
          'Observed executed its own checks against each capture\'s evidence. A check whose scope starts with "Imported from" reports another tool\'s result. Each result covers its stated expectation and scope; comparison availability is separate.',
          ...sides((side, label) => renderChecks(side, label, level + 1)),
        ],
      ),
      collapsed('Request ledger', [
        'Collector measurements from the recorded windows. A recorded response status is not a named check result.',
        ...sides((side, label) => renderLedger(side, label, level + 1)),
      ]),
      ...journeySections(journey).map((section) =>
        collapsed(evidenceKinds[section.kind].title, [
          renderMarkdownSection(section),
        ]),
      ),
      collapsed('Comparison availability', [renderAvailability(journey)]),
      collapsed('Screenshots and original artifacts', [
        'Screenshots are collector measurements. Artifact integrity describes availability and hash matches, not application correctness.',
        ...sides((side, label) => renderArtifacts(side, label, level + 1)),
      ]),
      collapsed('Captures, producer, conditions and recipe', [
        ...sides(
          (side, label) =>
            `${renderIdentity(side, label, level + 1)}\n\n${renderProvenance(side, `${label}: provenance`, level + 2)}`,
        ),
      ]),
    ],
  };
}

function renderChangeScope(result: Comparison): string[] {
  const scope = result.changeScope;
  const files = capturedFiles(result).map(
    (file) => `${file.path} (${file.change}): ${file.relation}. ${file.detail}`,
  );
  const outside =
    scope.kind === 'recorded'
      ? scope.files
          .filter((file) => !file.captured)
          .map((file) => `${repositoryPath(scope, file)} (${file.change})`)
      : [];
  const notes = scopeNotes(result);
  const recipe = recipeLine(scope);
  const differences = recipeLines(result);

  return [
    '## Change scope',
    escapeText(scopeLine(scope)),
    ...(files.length === 0 ? [] : [list(files)]),
    ...(notes.length === 0 ? [] : [list(notes)]),
    ...(recipe === null ? [] : [escapeText(recipe)]),
    ...(differences.length === 0 ? [] : [list(differences)]),
    ...(outside.length === 0
      ? []
      : [
          collapsed(`Files outside the captured source (${outside.length})`, [
            escapeText(
              `${relationLabels['outside-captured-source']}. ${statusWords.outsideCapturedSource.meaning}`,
            ),
            list(outside),
          ]),
        ]),
  ];
}

// The base and candidate revisions, so the pair stays in view.
function revisionLine(result: Comparison): string {
  const revision = (side: 'base' | 'candidate') => {
    const capture = result.journeys
      .map((journey) => journey[side].capture)
      .find((item) => item !== null);

    return capture === undefined
      ? 'capture unavailable'
      : describeRevision(capture.manifest.source.revision);
  };

  return escapeText(
    result.mode === 'preview'
      ? `Current: ${revision('candidate')}`
      : `Base: ${revision('base')} · Candidate: ${revision('candidate')}`,
  );
}

export function renderComparison(result: Comparison): string {
  const [first, ...rest] = result.journeys;
  const single = rest.length === 0 ? renderJourney(result, first, 2) : null;
  const journeys =
    single === null
      ? result.journeys.map((journey, index) => ({
          title: `Journey ${index + 1}: ${escapeText(journey.title)}`,
          rendered: renderJourney(result, journey, 3),
        }))
      : [];

  return [
    `# ${escapeText(result.title)}`,
    '## Conclusion',
    unobservedAfterPassing(result) > 0
      ? `**${runLabel(result)}** · ${unobservedText(unobservedAfterPassing(result))}`
      : `**${runLabel(result)}**`,
    escapeText(result.conclusion.text),
    `${escapeText(checkSummary(result))}.`,
    revisionLine(result),
    ...(single?.lead ??
      journeys.flatMap(({ title, rendered }) => [
        heading(2, title),
        ...rendered.lead,
      ])),
    ...(result.mode === 'preview' ? [] : renderChangeScope(result)),
    '## Evidence for audit',
    `Evaluated at: ${escapeText(result.evaluatedAt)}`,
    ...(single?.details ??
      journeys.flatMap(({ title, rendered }) => [
        heading(3, title),
        ...rendered.details,
      ])),
    'Observed renders the saved comparison result. Imported Phase 0 evidence reports are generated separately by the CLI.',
    '',
  ].join('\n\n');
}
