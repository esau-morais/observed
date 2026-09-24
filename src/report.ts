import { DateTime } from 'effect';
import path from 'node:path';
import type { ArtifactResult, EvidenceReport } from './evidence';
import type { Manifest } from './schema';

function text(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_{}[\]()#+!|~]/g, '\\$&')
    .replace(/\p{Cc}/gu, ' ');
}

function known(
  value: { kind: 'known'; value: string } | { kind: 'unknown'; reason: string },
): string {
  return value.kind === 'known'
    ? text(value.value)
    : `Unknown: ${text(value.reason)}`;
}

function revision(value: Manifest['capture']['revision']): string {
  return value.kind === 'unknown'
    ? `Unknown: ${text(value.reason)}`
    : `${value.kind}: ${text(value.value)}`;
}

function timestamp(value: Manifest['capture']['startedAt']): string {
  return value.kind === 'known'
    ? DateTime.formatIso(value.value)
    : `Unknown: ${text(value.reason)}`;
}

function evidenceLink(result: ArtifactResult, outputDirectory: string): string {
  if (result.kind === 'unavailable') {
    return `${text(result.artifact.id)} (unavailable)`;
  }

  const relative = path
    .relative(outputDirectory, result.absolutePath)
    .split(path.sep);
  const href = relative
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16)}`,
      ),
    )
    .join('/');

  return `[${text(result.artifact.id)}](./${href})`;
}

export function renderReport(
  report: EvidenceReport,
  outputDirectory: string,
): string {
  const { manifest, artifacts, checks } = report;
  const passed = checks.filter(
    (result) => result.outcome === 'imported passed',
  ).length;
  const failed = checks.filter(
    (result) => result.outcome === 'imported failed',
  ).length;
  const incomplete = checks.filter((result) => result.outcome === 'unknown');
  const unavailable = artifacts.filter(
    (result) => result.kind === 'unavailable',
  );
  const lines = [
    `# ${text(manifest.title)}`,
    '',
    '## Conclusion',
    '',
    `${passed} imported passed; ${failed} imported failed; ${incomplete.length} unknown checks.`,
    '',
    'Behavior was not independently verified by Observed. Change comparison and regression interpretation are unavailable in this Phase 0 report.',
    '',
    `Observed computed artifact availability and SHA-256 integrity only: ${artifacts.length - unavailable.length} available; ${unavailable.length} unavailable. Schema version 1 validated.`,
    '',
    '## Incomplete checks',
    '',
    ...incomplete.map(
      (result) =>
        `- ${text(result.check.name)}: ${result.reasons.map(text).join('; ')}`,
    ),
    ...(incomplete.length === 0
      ? [
          'None among the supplied checks. This does not establish complete application coverage.',
        ]
      : []),
    '',
    '## Supplied application and capture context',
    '',
    `- Application: ${text(manifest.application.name)}`,
    `- Location: ${known(manifest.application.location)}`,
    `- Repository: ${known(manifest.application.repository)}`,
    `- Base: ${revision(manifest.revisions.base)}`,
    `- Candidate: ${revision(manifest.revisions.candidate)}`,
    `- Captured revision: ${revision(manifest.capture.revision)}`,
    `- Capture: ${text(manifest.capture.id)}; execution: ${manifest.capture.execution}`,
    `- Started: ${timestamp(manifest.capture.startedAt)}`,
    `- Finished: ${timestamp(manifest.capture.finishedAt)}`,
    `- Producer: ${text(manifest.capture.producer.name)}; version: ${known(manifest.capture.producer.version)}`,
    `- Recipe: ${text(manifest.recipe.id)}; version: ${known(manifest.recipe.version)}; artifact: ${text(manifest.recipe.artifactId)} (hash below)`,
    ...manifest.capture.conditions.map(
      (condition) => `- Condition: ${text(condition)}`,
    ),
    '',
    '## Named checks',
    '',
    'All behavior outcomes below are supplied results. Available artifacts do not establish that their contents support the assertion. Unknown outcomes retain the original claim for inspection.',
    '',
  ];

  for (const { check, outcome, reasons } of checks) {
    const detail =
      check.result.kind === 'unknown'
        ? check.result.reason
        : check.result.detail;
    const references = artifacts.filter((result) =>
      check.artifactIds.includes(result.artifact.id),
    );

    lines.push(
      `### ${text(check.name)} (${text(check.id)})`,
      '',
      `- Reported outcome: **${outcome}**`,
      `- Supplied result: ${check.result.kind}; ${text(detail)}`,
      `- Expectation: ${text(check.expectation)}`,
      `- Scope: ${text(check.scope)}`,
      `- Method: ${text(check.method)}`,
      `- Supplied by: ${text(check.suppliedBy)}`,
      `- Evidence: ${references.length === 0 ? 'none' : references.map((result) => evidenceLink(result, outputDirectory)).join(', ')}`,
      ...reasons.map((reason) => `- Incomplete: ${text(reason)}`),
      '',
    );
  }

  lines.push(
    '## Artifact integrity computed by Observed',
    '',
    'Hashes establish file consistency, not truthful collection or application behavior.',
    '',
  );

  for (const result of artifacts) {
    lines.push(
      `- ${evidenceLink(result, outputDirectory)}: ${text(result.artifact.description)}`,
    );

    if (result.kind === 'unavailable') {
      lines.push(`  - Unknown: ${text(result.reason)}`);
    } else {
      lines.push(
        `  - SHA-256 ${result.integrity === 'matched' ? 'matched supplied hash' : 'computed; no supplied hash to verify'}: \`${result.hash}\``,
      );
    }
  }

  lines.push(
    '',
    '## Missing prerequisites and interpretation limits',
    '',
    ...manifest.missingPrerequisites.map((item) => `- Missing: ${text(item)}`),
    ...manifest.limitations.map((item) => `- ${text(item)}`),
    '- Supplied identities, timestamps, conditions, and outcomes are not authenticated by Observed.',
    '- No freshness, capture compatibility, source causation, or merge readiness is established.',
    '- Integrity describes files read during generation. Keep the bundle immutable; later edits invalidate this report.',
    '',
  );

  return lines.join('\n');
}
