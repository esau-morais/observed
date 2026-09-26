import { Option, Schema } from 'effect';
import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  comparisonSchema,
  conclusionExitCodes,
  type Comparison,
  type Side,
} from '../src/comparison-model';
import { escapeText } from '../src/comparison-report';
import { projectSchema, type Project } from '../src/project';

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
  const revision = side.capture?.manifest.source.revision ?? 'unavailable';

  return `| ${label} | ${escapeText(revision)} | ${side.execution} | ${side.check.outcome} |`;
}

function formatExit(exitCode: number | null): string {
  return exitCode === null ? 'missing' : String(exitCode);
}

export function summarize(options: {
  output: string | null;
  exitCode: number | null;
  artifact: string;
}): { markdown: string; trusted: boolean } {
  const decoded =
    options.output === null
      ? Option.none()
      : Schema.decodeUnknownOption(runOutputSchema)(options.output);
  const evidence = `Evidence: workflow artifact ${escapeText(options.artifact)}. Download it and run \`bun run view <download>/run/report\` from an Observed checkout.`;
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
  const sides =
    result.mode === 'preview'
      ? [describeSide('Current', result.candidate)]
      : [
          describeSide('Base', result.base),
          describeSide('Candidate', result.candidate),
        ];

  const markdown = [
    `## Observed: ${outcome.heading}`,
    `Exit code ${String(expected)}. ${outcome.meaning}`,
    escapeText(result.conclusion.text),
    [
      '| Side | Source revision | Capture | Check |',
      '| --- | --- | --- | --- |',
      ...sides,
    ].join('\n'),
    evidence,
    '### Limits',
    result.limitations.map((item) => `- ${escapeText(item)}`).join('\n'),
  ].join('\n\n');

  return { markdown, trusted: true };
}

export function fillSteps(project: Project): number {
  return [...project.capture.ready, ...project.capture.steps].filter(
    (step) => step.kind === 'fill',
  ).length;
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
  } catch {
    return null;
  }
}

async function notRun(reason: string): Promise<never> {
  await writeSummary(['## Observed: not run', reason].join('\n\n'));
  process.stderr.write(`Observed: ${reason}\n`);
  process.exit(1);
}

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);

  if (command === 'preflight' && args.length === 1) {
    const project = Schema.decodeUnknownOption(
      Schema.fromJsonString(projectSchema),
      { onExcessProperty: 'error' },
    )((await readOptional(path.join(args[0] ?? '.', 'observed.json'))) ?? '');

    if (Option.isNone(project)) {
      await notRun(
        'observed.json is missing or does not match the project contract in src/project.ts.',
      );
    } else if (fillSteps(project.value) > 0) {
      await notRun(
        'This project fills form fields. This version of Observed writes fill values into the exported evidence, so the action does not run or upload projects with fill steps.',
      );
    }
  } else if (command === 'summary' && args.length === 3) {
    const [resultFile = '', exitCode = '', artifact = ''] = args;
    const summary = summarize({
      output: await readOptional(resultFile),
      exitCode: Option.getOrNull(
        Schema.decodeUnknownOption(exitCodeSchema)(exitCode),
      ),
      artifact,
    });

    await writeSummary(summary.markdown);

    if (!summary.trusted) {
      process.exit(1);
    }
  } else {
    process.stderr.write(
      'Usage: github-action.ts preflight <project> | summary <result.json> <exit-code> <artifact-name>\n',
    );
    process.exit(64);
  }
}
