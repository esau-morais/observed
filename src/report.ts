import { DateTime } from 'effect';
import path from 'node:path';
import type { ArtifactResult, CheckResult, EvidenceReport } from './evidence';
import type { Manifest } from './schema';

function escapeMarkdownText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_{}[\]()#+!|~]/g, '\\$&')
    .replace(/\p{Cc}/gu, ' ');
}

function known(value: Manifest['application']['location']): string {
  return value.kind === 'known'
    ? escapeMarkdownText(value.value)
    : `Unknown: ${escapeMarkdownText(value.reason)}`;
}

function revision(value: Manifest['capture']['revision']): string {
  return value.kind === 'unknown'
    ? `Unknown: ${escapeMarkdownText(value.reason)}`
    : `${value.kind}: ${escapeMarkdownText(value.value)}`;
}

function timestamp(value: Manifest['capture']['startedAt']): string {
  return value.kind === 'known'
    ? DateTime.formatIso(value.value)
    : `Unknown: ${escapeMarkdownText(value.reason)}`;
}

function evidenceLink(result: ArtifactResult, outputDirectory: string): string {
  if (result.kind === 'unavailable') {
    return `${escapeMarkdownText(result.artifact.id)} (unavailable)`;
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

  return `[${escapeMarkdownText(result.artifact.id)}](./${href})`;
}

function renderCheck(
  { check, outcome, reasons }: CheckResult,
  evidence: string,
): string {
  const detail =
    check.result.kind === 'unknown' ? check.result.reason : check.result.detail;

  const incomplete = reasons
    .map((reason) => `- Incomplete: ${escapeMarkdownText(reason)}`)
    .join('\n');

  return `### ${escapeMarkdownText(check.name)} (${escapeMarkdownText(check.id)})

- Reported outcome: **${outcome}**
- Supplied result: ${check.result.kind}; ${escapeMarkdownText(detail)}
- Expectation: ${escapeMarkdownText(check.expectation)}
- Scope: ${escapeMarkdownText(check.scope)}
- Method: ${escapeMarkdownText(check.method)}
- Supplied by: ${escapeMarkdownText(check.suppliedBy)}
- Evidence: ${evidence}
${incomplete}`.trimEnd();
}

function renderArtifact(result: ArtifactResult, link: string): string {
  let integrity: string;

  if (result.kind === 'unavailable') {
    integrity = `Unknown: ${escapeMarkdownText(result.reason)}`;
  } else {
    const label =
      result.integrity === 'matched'
        ? 'matched supplied hash'
        : 'computed; no supplied hash to verify';

    integrity = `SHA-256 ${label}: \`${result.hash}\``;
  }

  return `- ${link}: ${escapeMarkdownText(result.artifact.description)}
  - ${integrity}`;
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
  ).length;

  const linkedArtifacts = artifacts.map((result, index) => ({
    result,
    index,
    link: evidenceLink(result, outputDirectory),
  }));

  const byId = new Map(
    linkedArtifacts.map((item) => [item.result.artifact.id, item]),
  );

  const namedChecks = checks
    .map((result) => {
      const references = [...new Set(result.check.artifactIds)]
        .map((id) => byId.get(id))
        .filter((item) => item !== undefined)
        .sort((left, right) => left.index - right.index);

      const evidence =
        references.length === 0
          ? 'none'
          : references.map((item) => item.link).join(', ');

      return renderCheck(result, evidence);
    })
    .join('\n\n');

  const incompleteChecks =
    incomplete.length === 0
      ? 'None among the supplied checks. This does not establish complete application coverage.'
      : incomplete
          .map(
            (result) =>
              `- ${escapeMarkdownText(result.check.name)}: ${result.reasons.map(escapeMarkdownText).join('; ')}`,
          )
          .join('\n');

  const conditions = manifest.capture.conditions
    .map((condition) => `- Condition: ${escapeMarkdownText(condition)}`)
    .join('\n');

  const integrity = linkedArtifacts
    .map(({ result, link }) => renderArtifact(result, link))
    .join('\n');

  const limitations = [
    ...manifest.missingPrerequisites.map(
      (item) => `- Missing: ${escapeMarkdownText(item)}`,
    ),
    ...manifest.limitations.map((item) => `- ${escapeMarkdownText(item)}`),
  ].join('\n');

  return `# ${escapeMarkdownText(manifest.title)}

## Conclusion

${passed} imported passed; ${failed} imported failed; ${incomplete.length} unknown checks.

Behavior was not independently verified by Observed. Change comparison and regression interpretation are unavailable in this Phase 0 report.

Observed computed artifact availability and SHA-256 integrity only: ${artifacts.length - unavailable} available; ${unavailable} unavailable. Schema version 1 validated.

Evidence: ${linkedArtifacts.map((item) => item.link).join(', ')}

## Incomplete checks

${incompleteChecks}

## Supplied application and capture context

- Application: ${escapeMarkdownText(manifest.application.name)}
- Location: ${known(manifest.application.location)}
- Repository: ${known(manifest.application.repository)}
- Base: ${revision(manifest.revisions.base)}
- Candidate: ${revision(manifest.revisions.candidate)}
- Captured revision: ${revision(manifest.capture.revision)}
- Capture: ${escapeMarkdownText(manifest.capture.id)}; execution: ${manifest.capture.execution}
- Started: ${timestamp(manifest.capture.startedAt)}
- Finished: ${timestamp(manifest.capture.finishedAt)}
- Producer: ${escapeMarkdownText(manifest.capture.producer.name)}; version: ${known(manifest.capture.producer.version)}
- Recipe: ${escapeMarkdownText(manifest.recipe.id)}; version: ${known(manifest.recipe.version)}; artifact: ${escapeMarkdownText(manifest.recipe.artifactId)} (hash below)
${conditions}

## Named checks

All behavior outcomes below are supplied results. Available artifacts do not establish that their contents support the assertion. Unknown outcomes retain the original claim for inspection.

${namedChecks}

## Artifact integrity computed by Observed

Hashes establish file consistency, not truthful collection or application behavior.

${integrity}

## Missing prerequisites and interpretation limits

${limitations}
- Supplied identities, timestamps, conditions, and outcomes are not authenticated by Observed.
- No freshness, capture compatibility, source causation, or merge readiness is established.
- Integrity describes files read during generation. Keep the bundle immutable; later edits invalidate this report.
`;
}
