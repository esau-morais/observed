import { BunServices } from '@effect/platform-bun';
import { Cause, Effect, Exit, Option, Schema } from 'effect';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
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
import { describeRevision } from '../src/provenance-text';

const runOutputSchema = Schema.fromJsonString(
  Schema.Struct({ directory: Schema.String, result: comparisonSchema }),
);

const exitCodeSchema = Schema.NumberFromString.check(Schema.isInt());

type Kind = Comparison['conclusion']['kind'];

const outcomes = {
  regression: {
    heading: 'Regression',
    meaning: 'The job fails because a named check regressed.',
  },
  'check-failed': {
    heading: 'Check failed',
    meaning: 'The job fails because a named check failed.',
  },
  unavailable: {
    heading: 'Unavailable',
    meaning:
      'The job fails because evidence is unavailable. This is not a pass.',
  },
  'no-regression': {
    heading: 'No regression',
    meaning:
      'The job passes. This covers only the check and journey listed here.',
  },
  'not-checked': {
    heading: 'Not checked',
    meaning:
      'The job passes, but no named check is configured, so no behavior was verified.',
  },
  preview: {
    heading: 'Preview',
    meaning:
      'The job passes. A preview captures one revision and verifies no behavior.',
  },
} satisfies Record<Kind, { heading: string; meaning: string }>;

function describeSide(label: string, side: Side): string {
  const revision =
    side.capture === null
      ? 'unavailable'
      : describeRevision(side.capture.manifest.source.revision);

  return `| ${label} | ${escapeText(revision)} | ${side.execution} | ${side.check.outcome} |`;
}

export function describeFailure(
  label: string,
  execution: Capture['execution'] | undefined,
): string[] {
  return execution?.kind === 'failed'
    ? [
        `- ${label} capture failed (${execution.category}): ${escapeText(execution.reason)}`,
      ]
    : [];
}

function formatExit(exitCode: number | null): string {
  return exitCode === null ? 'missing' : String(exitCode);
}

const pageUrlSchema = Schema.String.check(
  Schema.isPattern(/^https:\/\/[^\s()<>[\]]+$/),
);

export function summarize(options: {
  output: string | null;
  exitCode: number | null;
  artifact: string;
  page: string | null;
}): { markdown: string; trusted: boolean } {
  const decoded =
    options.output === null
      ? Option.none()
      : Schema.decodeUnknownOption(runOutputSchema)(options.output);
  const page = Option.getOrNull(
    Schema.decodeUnknownOption(pageUrlSchema)(options.page),
  );
  const bundle = `workflow artifact ${escapeText(options.artifact)}`;
  const evidence =
    page === null
      ? `No report page was uploaded. Evidence: ${bundle}. Download it and run \`bun run view <download>/run/report\` from an Observed checkout.`
      : `**[Open the report](${page})** with the screenshots, checks and requests. GitHub shows it to signed-in users who can read this repository until the artifact expires. Raw evidence: ${bundle}.`;
  const untrusted = (reason: string) => ({
    markdown: [
      '## Observed: no result',
      `${reason} The job fails. Treat this run as unavailable, not passed. The job log has details.`,
      evidence,
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

  const outcome = outcomes[result.conclusion.kind];
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

  const markdown = [
    `## Observed: ${outcome.heading}`,
    `Exit code ${String(expected)}. ${outcome.meaning}`,
    evidence,
    escapeText(result.conclusion.text),
    [
      '| Side | Source revision | Capture | Check |',
      '| --- | --- | --- | --- |',
      ...labelled.map(([label, side]) => describeSide(label, side)),
    ].join('\n'),
    ...(failures.length === 0 ? [] : [failures.join('\n')]),
    '### Limits',
    result.limitations.map((item) => `- ${escapeText(item)}`).join('\n'),
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
  } else if (command === 'page' && args.length === 2) {
    const [directory = '', output = ''] = args;
    const page = await Effect.runPromise(
      renderReportPage(path.resolve(directory)).pipe(
        Effect.provide(BunServices.layer),
      ),
    );

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
    });

    await writeSummary(summary.markdown);

    if (!summary.trusted) {
      process.exit(1);
    }
  } else {
    process.stderr.write(
      'Usage: github-action.ts preflight <project> | page <report-directory> <output.html> | summary <result.json> <exit-code> <artifact-name> <page-url>\n',
    );
    process.exit(64);
  }
}
