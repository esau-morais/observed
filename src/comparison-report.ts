import type { Comparison, Side, Visual } from './comparison-model';
import { describeObserved, describeRevision } from './provenance-text';
import { describeRegion, describeVisual, diffLegend } from './visual-text';

export function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_{}[\]()#+!|~.=-]/g, '\\$&')
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ');
}

function link(label: string, path: string): string {
  const destination = path.replace(/[<>\s\\]/g, (character) =>
    encodeURIComponent(character),
  );

  return `[${escapeText(label)}](<${destination}>)`;
}

function list(values: readonly string[]): string {
  return values.map((value) => `- ${escapeText(value)}`).join('\n');
}

function renderIdentity(side: Side, label: string): string {
  if (side.capture === null) {
    return `### ${label}\n\nCapture unavailable.\n\nExecution: ${side.execution}.`;
  }

  const capture = side.capture.manifest;

  return [
    `### ${label}`,
    `- Label: ${escapeText(capture.label)}`,
    `- Full snapshot SHA-256: ${escapeText(capture.source.sha256)}`,
    `- Capture started (UTC): ${escapeText(capture.startedAt)}`,
    `- Capture finished (UTC): ${escapeText(capture.finishedAt)}`,
    `- Execution: ${side.execution}`,
  ].join('\n\n');
}

function renderCheck(side: Side, label: string): string {
  const check = side.check;

  return [
    `### ${label}: ${escapeText(check.name)}`,
    `**${check.outcome}** · ${escapeText(check.authority)}`,
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

function renderAvailability(result: Comparison): string {
  const comparison = result.comparison;

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

function renderLedger(side: Side, label: string): string {
  if (side.execution !== 'complete') {
    return `### ${label}\n\nRequest evidence unavailable.`;
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
              `| ${escapeText(request.method)} | ${escapeText(`${request.origin === 'application' ? '' : request.origin}${request.path}`)} | ${request.status} | ${escapeText(request.startedAt)} |`,
          ),
        ].join('\n');

  const errors =
    observations.browserErrors.length === 0
      ? 'No browser errors recorded during capture.'
      : `Recorded browser errors:\n\n${list(observations.browserErrors)}`;

  return [
    `### ${label}`,
    `Recorded window: ${escapeText(observations.window.startedAt)} to ${escapeText(observations.window.finishedAt)}.`,
    requests,
    errors,
  ].join('\n\n');
}

function renderArtifacts(side: Side, label: string): string {
  const artifacts = side.artifacts.map((artifact) => {
    const reference =
      artifact.integrity === 'verified'
        ? link(artifact.id, artifact.path)
        : escapeText(artifact.id);

    const reason =
      artifact.integrity === 'verified'
        ? ''
        : ` ${escapeText(artifact.reason)}`;

    return `- ${reference}: ${escapeText(artifact.description)}\n  - Artifact integrity: ${artifact.integrity}.${reason}`;
  });

  const screenshot =
    side.screenshot === null
      ? 'Screenshot unavailable.'
      : link(
          `Open ${label.toLowerCase()} screenshot at full size`,
          side.screenshot,
        );

  return [
    `### ${label}`,
    screenshot,
    artifacts.length === 0 ? 'No artifacts available.' : artifacts.join('\n'),
  ].join('\n\n');
}

function renderProvenance(side: Side, label: string): string {
  if (side.capture === null) {
    return `### ${label}\n\nCapture metadata unavailable.`;
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
    `### ${label}`,
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

export function renderComparison(result: Comparison): string {
  const candidateLabel =
    result.mode === 'preview' ? 'Current capture' : 'Candidate · after';
  const screenshots =
    result.mode === 'preview'
      ? [{ side: result.candidate, label: 'Current capture' }]
      : [
          { side: result.base, label: 'Before' },
          { side: result.candidate, label: 'After' },
        ];
  const conclusionLabels = {
    regression: 'Regression',
    'no-regression': 'No regression',
    unavailable: 'Conclusion unavailable',
    'not-checked': 'Visual comparison',
    preview: 'Preview',
    'check-failed': 'Check failed',
  };

  const unresolved = [
    ...(result.mode === 'preview'
      ? []
      : result.base.unresolved.map((reason) => `Base: ${reason}`)),
    ...result.candidate.unresolved.map((reason) => `Candidate: ${reason}`),
    ...result.limitations,
  ];

  return [
    `# ${escapeText(result.title)}`,
    ...screenshots.map(({ side, label }) =>
      [
        `## ${label}`,
        side.capture === null
          ? 'Capture unavailable.'
          : `Source: ${escapeText(describeRevision(side.capture.manifest.source.revision))} · ${side.capture.manifest.source.sha256}`,
        side.screenshot === null
          ? 'Screenshot unavailable.'
          : `!${link(`${label} captured application`, side.screenshot)}`,
      ].join('\n\n'),
    ),
    '## Conclusion',
    `**${conclusionLabels[result.conclusion.kind]}**`,
    escapeText(result.conclusion.text),
    `Evaluated at: ${escapeText(result.evaluatedAt)}`,
    '## Unresolved evidence and limits',
    unresolved.length === 0
      ? 'No unresolved items reported. Coverage is limited to the named checks and recorded capture windows.'
      : list(unresolved),
    '## Selected captures',
    ...(result.mode === 'preview'
      ? []
      : [renderIdentity(result.base, 'Base · before')]),
    renderIdentity(result.candidate, candidateLabel),
    '## Comparison availability',
    renderAvailability(result),
    '## Absolute named checks',
    "Executed by Observed against each capture's evidence. Each result covers its stated expectation and scope; comparison availability is separate.",
    ...(result.mode === 'preview'
      ? []
      : [renderCheck(result.base, 'Base · before')]),
    renderCheck(result.candidate, candidateLabel),
    '## Request ledger',
    'Collector measurements from the recorded windows. A recorded response status is not a named check result.',
    ...(result.mode === 'preview'
      ? []
      : [renderLedger(result.base, 'Base · before')]),
    renderLedger(result.candidate, candidateLabel),
    '## Screenshots and original artifacts',
    'Screenshots are collector measurements. Artifact integrity describes availability and hash verification, not application correctness.',
    ...(result.mode === 'preview'
      ? []
      : [renderArtifacts(result.base, 'Base · before')]),
    renderArtifacts(result.candidate, candidateLabel),
    '## Observed, producer, conditions and recipe',
    ...(result.mode === 'preview'
      ? []
      : [renderProvenance(result.base, 'Base · before')]),
    renderProvenance(result.candidate, candidateLabel),
    'Observed renders the saved comparison result. Imported Phase 0 evidence reports are generated separately by the CLI.',
    '',
  ].join('\n\n');
}
