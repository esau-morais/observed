import { scopeFileLines, scopeLine } from './change-scope-text';
import { escapeText, link } from './markdown';
import {
  checkLabels,
  checkSummary,
  conclusionLabels,
  executionLabels,
  integrityLabels,
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
import { journeySections, renderMarkdownSection } from './report-sections';
import { describeObserved, describeRevision } from './provenance-text';
import { describeStatus } from './request-text';
import { describeRegion, describeVisual, diffLegend } from './visual-text';

function heading(level: number, text: string): string {
  return `${'#'.repeat(level)} ${text}`;
}

function list(values: readonly string[]): string {
  return values.map((value) => `- ${escapeText(value)}`).join('\n');
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
    `- **${verdictLabels[verdict.verdict]}**: ${escapeText(verdict.name)}`,
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
): { screenshots: string[]; details: string[] } {
  const preview = result.mode === 'preview';
  const candidateLabel = preview ? 'Current capture' : 'Candidate · after';
  const sides = (render: (side: Side, label: string) => string) => [
    ...(preview ? [] : [render(journey.base, 'Base · before')]),
    render(journey.candidate, candidateLabel),
  ];
  const screenshots = preview
    ? [{ side: journey.candidate, label: 'Current capture' }]
    : [
        { side: journey.base, label: 'Before' },
        { side: journey.candidate, label: 'After' },
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

  return {
    screenshots: screenshots.map(({ side, label }) =>
      [
        heading(level, label),
        side.capture === null
          ? 'Capture unavailable.'
          : `Source: ${escapeText(describeRevision(side.capture.manifest.source.revision))} · ${side.capture.manifest.source.sha256}`,
        side.screenshot === null
          ? 'Screenshot unavailable.'
          : `!${link(`${label} captured application`, side.screenshot)}`,
      ].join('\n\n'),
    ),
    details: [
      ...(single
        ? []
        : [
            heading(level, 'Journey conclusion'),
            `**${conclusionLabels[journey.conclusion.kind]}**`,
            escapeText(journey.conclusion.text),
          ]),
      heading(level, 'Unresolved evidence and limits'),
      unresolved.length === 0
        ? 'No unresolved items reported. Coverage is limited to the named checks and recorded capture windows.'
        : list(unresolved),
      heading(level, 'Selected captures'),
      ...sides((side, label) => renderIdentity(side, label, level + 1)),
      heading(level, 'Comparison availability'),
      renderAvailability(journey),
      heading(level, 'Named checks'),
      'Observed executed its own checks against each capture\'s evidence. A check whose scope starts with "Imported from" reports another tool\'s result. Each result covers its stated expectation and scope; comparison availability is separate.',
      journey.checks.length === 0
        ? 'No named check configured.'
        : journey.checks.map(renderVerdict).join('\n'),
      ...sides((side, label) => renderChecks(side, label, level + 1)),
      heading(level, 'Request ledger'),
      'Collector measurements from the recorded windows. A recorded response status is not a named check result.',
      ...sides((side, label) => renderLedger(side, label, level + 1)),
      ...journeySections(journey).flatMap((section) => [
        heading(level, escapeText(evidenceKinds[section.kind].title)),
        renderMarkdownSection(section),
      ]),
      heading(level, 'Screenshots and original artifacts'),
      'Screenshots are collector measurements. Artifact integrity describes availability and hash matches, not application correctness.',
      ...sides((side, label) => renderArtifacts(side, label, level + 1)),
      heading(level, 'Observed, producer, conditions and recipe'),
      ...sides((side, label) => renderProvenance(side, label, level + 1)),
    ],
  };
}

function renderChangeScope(result: Comparison): string[] {
  const files = scopeFileLines(result);

  return [
    '## Change scope',
    escapeText(scopeLine(result.changeScope)),
    ...(files.length === 0 ? [] : [list(files)]),
  ];
}

export function renderComparison(result: Comparison): string {
  const [first, ...rest] = result.journeys;
  const single = rest.length === 0 ? renderJourney(result, first, 2) : null;

  return [
    `# ${escapeText(result.title)}`,
    ...(single?.screenshots ?? []),
    '## Conclusion',
    `**${conclusionLabels[result.conclusion.kind]}**`,
    escapeText(result.conclusion.text),
    `${escapeText(checkSummary(result))}.`,
    ...(result.mode === 'preview' ? [] : renderChangeScope(result)),
    `Evaluated at: ${escapeText(result.evaluatedAt)}`,
    ...(single?.details ??
      result.journeys.flatMap((journey, index) => {
        const rendered = renderJourney(result, journey, 3);

        return [
          `## Journey ${index + 1}: ${escapeText(journey.title)}`,
          ...rendered.screenshots,
          ...rendered.details,
        ];
      })),
    'Observed renders the saved comparison result. Imported Phase 0 evidence reports are generated separately by the CLI.',
    '',
  ].join('\n\n');
}
