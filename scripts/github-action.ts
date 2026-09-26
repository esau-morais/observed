import { BunServices } from '@effect/platform-bun';
import { Cause, Effect, Exit, Option, Schema } from 'effect';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  comparisonSchema,
  conclusionExitCodes,
  type Comparison,
  type Side,
} from '../src/comparison-model';
import type { Capture } from '../src/capture/model';
import { escapeText } from '../src/comparison-report';
import { loadProject } from '../src/project';
import { renderReportPage } from '../src/report-page';
import { describeRevision, shortSource } from '../src/provenance-text';
import { describeVisual } from '../src/visual-text';
import {
  checkLabels,
  conclusionTones,
  coverage,
  executionLabels,
  headline,
  type Tone,
} from '../src/result-text';

const runOutputSchema = Schema.fromJsonString(
  Schema.Struct({ directory: Schema.String, result: comparisonSchema }),
);

const exitCodeSchema = Schema.NumberFromString.check(Schema.isInt());

type Kind = Comparison['conclusion']['kind'];

const alerts = {
  regression: 'CAUTION',
  unknown: 'WARNING',
  checked: 'NOTE',
  neutral: 'NOTE',
} satisfies Record<Tone, string>;

const consequences = {
  regression: 'The job fails.',
  'check-failed': 'The job fails.',
  unavailable: 'Missing evidence is not a pass. The job fails.',
  'no-regression': 'The job passes.',
  'not-checked': 'The job passes.',
  preview: 'A preview compares no revisions. The job passes.',
} satisfies Record<Kind, string>;

// GitHub autolinks bare URLs even when their punctuation is escaped.
export function inlineText(value: string): string {
  return value
    .split(/(https?:\/\/[^\s`]+)/)
    .map((part, index) =>
      index % 2 === 1
        ? `\`${part.replace(/\.$/, '')}\`${part.endsWith('.') ? '.' : ''}`
        : escapeText(part),
    )
    .join('');
}

function revisionCell(side: Side, repository: string | null): string {
  if (side.capture === null) {
    return 'Unavailable';
  }

  const revision = side.capture.manifest.source.revision;
  const label = `\`${shortSource(side.capture.manifest.source)}\``;

  return repository !== null && revision.kind === 'commit'
    ? `[${label}](${repository}/commit/${revision.commit})`
    : label;
}

function sideRow(label: string, side: Side, repository: string | null) {
  return `| ${label} | ${revisionCell(side, repository)} | ${executionLabels[side.execution]} | ${checkLabels[side.check.outcome]} |`;
}

export function describeFailure(
  label: string,
  execution: Capture['execution'] | undefined,
): string[] {
  return execution?.kind === 'failed'
    ? [
        `- ${label} capture failed (${execution.category}): ${inlineText(execution.reason)}`,
      ]
    : [];
}

function formatExit(exitCode: number | null): string {
  return exitCode === null ? 'missing' : String(exitCode);
}

export function pageMatchesRun(page: string, output: string | null): boolean {
  const run =
    output === null
      ? Option.none()
      : Schema.decodeUnknownOption(runOutputSchema)(output);
  const shown = Schema.decodeUnknownOption(
    Schema.fromJsonString(comparisonSchema),
  )(page);

  return (
    Option.isSome(run) &&
    Option.isSome(shown) &&
    isDeepStrictEqual(run.value.result, shown.value)
  );
}

const httpsUrlSchema = Schema.String.check(
  Schema.isPattern(/^https:\/\/[^\s()<>[\]]+$/),
);

function alert(kind: string, lines: string[]): string {
  return [
    `> [!${kind}]`,
    ...lines.flatMap((line, index) =>
      index === 0 ? [`> ${line}`] : ['>', `> ${line}`],
    ),
  ].join('\n');
}

function collapsed(summary: string, items: string[]): string {
  return [
    `<details><summary>${summary}</summary>`,
    '',
    items.map((item) => `- ${item}`).join('\n'),
    '',
    '</details>',
  ].join('\n');
}

export function summarize(options: {
  output: string | null;
  exitCode: number | null;
  artifact: string;
  page: string | null;
  repository?: string | null;
}): { markdown: string; trusted: boolean } {
  const decoded =
    options.output === null
      ? Option.none()
      : Schema.decodeUnknownOption(runOutputSchema)(options.output);
  const page = Option.getOrNull(
    Schema.decodeUnknownOption(httpsUrlSchema)(options.page),
  );
  const repository = Option.getOrNull(
    Schema.decodeUnknownOption(httpsUrlSchema)(options.repository ?? null),
  );
  const bundle = `Raw evidence: workflow artifact \`${options.artifact.replaceAll('`', '')}\`. Download it and run \`bun run view <download>/run/report\` from an Observed checkout.`;
  const exit = `Observed exited with code ${formatExit(options.exitCode)}.`;
  const untrusted = (reason: string) => ({
    markdown: [
      alert('WARNING', [
        '**No result. Treat this run as unavailable, not passed.**',
        `${reason} The job fails. The job log has details.`,
      ]),
      bundle,
    ].join('\n\n'),
    trusted: false,
  });

  if (Option.isNone(decoded)) {
    return untrusted(
      `Observed exited with code ${formatExit(options.exitCode)} and wrote no readable result.`,
    );
  }

  const { result } = decoded.value;
  const expected = conclusionExitCodes[result.conclusion.kind];

  if (options.exitCode !== expected) {
    return untrusted(
      `Observed exited with code ${formatExit(options.exitCode)}, but its ${result.conclusion.kind} result maps to ${String(expected)}.`,
    );
  }

  const kind = result.conclusion.kind;
  const labelled: [string, Side][] =
    result.mode === 'preview'
      ? [['Current', result.candidate]]
      : [
          ['Base', result.base],
          ['Candidate', result.candidate],
        ];
  const failures = labelled.flatMap(([label, side]) =>
    describeFailure(label, side.capture?.manifest.execution),
  );
  const reasons =
    failures.length > 0 || result.comparison.kind !== 'unavailable'
      ? failures
      : result.comparison.reasons.map((reason) => `- ${inlineText(reason)}`);
  const visual =
    result.comparison.kind === 'available' &&
    (result.comparison.visual.kind === 'changed' ||
      result.comparison.visual.kind === 'size-differs')
      ? `Screenshots: ${inlineText(describeVisual(result.comparison.visual))} An observation, not a check.`
      : null;
  const scope = coverage(result);
  const links = [
    page === null ? null : `**[Open the report](${page})**`,
    scope === null ? null : `Covered: ${inlineText(scope)}`,
  ].filter((item) => item !== null);
  const revisions = labelled.flatMap(([label, side]) =>
    side.capture === null
      ? []
      : [
          `${label}: \`${describeRevision(side.capture.manifest.source.revision)}\``,
        ],
  );

  const markdown = [
    alert(alerts[conclusionTones[kind]], [
      `**${inlineText(headline(result))}**`,
      `${inlineText(result.conclusion.text.replace(/\.?$/, '.'))} ${consequences[kind]}`,
    ]),
    [
      '| | Revision | Capture | Check |',
      '| --- | --- | --- | --- |',
      ...labelled.map(([label, side]) => sideRow(label, side, repository)),
    ].join('\n'),
    ...(reasons.length === 0 ? [] : [reasons.join('\n')]),
    ...(visual === null ? [] : [visual]),
    ...(links.length === 0 ? [] : [links.join(' · ')]),
    ...(page === null ? [`No report page was uploaded. ${bundle}`] : []),
    collapsed('Limits and raw evidence', [
      ...(result.comparison.kind === 'unavailable' && failures.length > 0
        ? result.comparison.reasons.map(inlineText)
        : []),
      ...result.limitations
        .filter((limitation) => limitation !== scope)
        .map(inlineText),
      ...revisions,
      ...(page === null
        ? []
        : [
            'The report opens for signed-in users who can read this repository, until the artifact expires.',
            bundle,
          ]),
      exit,
    ]),
  ].join('\n\n');

  return { markdown, trusted: true };
}

async function writeSummary(markdown: string) {
  const file = process.env.GITHUB_STEP_SUMMARY;

  if (file === undefined || file === '') {
    process.stderr.write(`${markdown}\n`);

    return;
  }

  await appendFile(file, `${markdown}\n`);
}

async function readOptional(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

async function notRun(reason: string): Promise<never> {
  await writeSummary(['## Observed: not run', escapeText(reason)].join('\n\n'));
  process.stderr.write(`Observed: ${reason}\n`);
  process.exit(1);
}

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);

  if (command === 'preflight' && args.length === 1) {
    const loaded = await Effect.runPromiseExit(
      loadProject(path.resolve(args[0] ?? '.')).pipe(
        Effect.provide(BunServices.layer),
      ),
    );

    if (Exit.isFailure(loaded)) {
      const error = Cause.squash(loaded.cause);

      await notRun(
        `observed.json could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else if (command === 'page' && args.length === 3) {
    const [directory = '', resultFile = '', output = ''] = args;
    const rendered = await Effect.runPromiseExit(
      renderReportPage(path.resolve(directory)).pipe(
        Effect.provide(BunServices.layer),
      ),
    );

    if (Exit.isFailure(rendered)) {
      const error = Cause.squash(rendered.cause);

      process.stderr.write(
        `Observed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exit(1);
    }

    const { page, result } = rendered.value;

    if (!pageMatchesRun(result, await readOptional(resultFile))) {
      process.stderr.write(
        "Observed: the report page's result differs from this run's result.json.\n",
      );
      process.exit(1);
    }

    await writeFile(output, page, { flag: 'wx' });
  } else if (command === 'summary' && args.length === 4) {
    const [resultFile = '', exitCode = '', artifact = '', page = ''] = args;
    const summary = summarize({
      output: await readOptional(resultFile),
      exitCode: Option.getOrNull(
        Schema.decodeUnknownOption(exitCodeSchema)(exitCode),
      ),
      artifact,
      page: page === '' ? null : page,
      repository:
        process.env.GITHUB_SERVER_URL !== undefined &&
        process.env.GITHUB_REPOSITORY !== undefined
          ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}`
          : null,
    });

    await writeSummary(summary.markdown);

    if (!summary.trusted) {
      process.exit(1);
    }
  } else {
    process.stderr.write(
      'Usage: github-action.ts preflight <project> | page <report-directory> <result.json> <output.html> | summary <result.json> <exit-code> <artifact-name> <page-url>\n',
    );
    process.exit(64);
  }
}
