import { Option, Schema } from 'effect';
import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { comparisonSchema, type Comparison } from '../src/comparison-model';
import { escapeText } from '../src/comparison-report';
import { projectSchema, type Project } from '../src/project';

const runOutputSchema = Schema.fromJsonString(
  Schema.Struct({ directory: Schema.String, result: comparisonSchema }),
);

const exitCodeSchema = Schema.NumberFromString.check(Schema.isInt());

const headings = {
  regression: 'Regression',
  'check-failed': 'Check failed',
  unavailable: 'Unavailable',
  'no-regression': 'No regression',
  'not-checked': 'Not checked',
  preview: 'Preview',
} satisfies Record<Comparison['conclusion']['kind'], string>;

const exitMeanings = new Map([
  [
    0,
    'Exit code 0. The job passes. This covers only the check and journey listed here.',
  ],
  [
    1,
    'Exit code 1. The job fails because evidence is unavailable. This is not a pass.',
  ],
  [2, 'Exit code 2. The job fails because a named check failed or regressed.'],
]);

function describeExit(exitCode: number | null): string {
  if (exitCode === null) {
    return 'Exit code missing. The job fails.';
  }

  return (
    exitMeanings.get(exitCode) ??
    `Exit code ${String(exitCode)}. The job fails.`
  );
}

function describeSide(label: string, side: Comparison['base']): string {
  const revision = side.capture?.manifest.source.revision ?? 'unavailable';

  return `| ${label} | ${escapeText(revision)} | ${side.execution} | ${side.check.outcome} |`;
}

export function summarize(options: {
  output: string | null;
  exitCode: number | null;
  artifact: string;
}): { markdown: string; readable: boolean } {
  const decoded =
    options.output === null
      ? Option.none()
      : Schema.decodeUnknownOption(runOutputSchema)(options.output);
  const evidence = `Evidence: workflow artifact ${escapeText(options.artifact)}. Download it and run \`bun run view <download>/run/report\` from an Observed checkout.`;

  if (Option.isNone(decoded)) {
    return {
      markdown: [
        '## Observed: no result',
        `Observed exited with code ${options.exitCode === null ? 'missing' : String(options.exitCode)} and wrote no readable result. The job fails. Treat this run as unavailable, not passed. The job log has the error.`,
        evidence,
      ].join('\n\n'),
      readable: false,
    };
  }

  const { result } = decoded.value;
  const sides =
    result.mode === 'preview'
      ? [describeSide('Current', result.candidate)]
      : [
          describeSide('Base', result.base),
          describeSide('Candidate', result.candidate),
        ];

  const markdown = [
    `## Observed: ${headings[result.conclusion.kind]}`,
    describeExit(options.exitCode),
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

  return { markdown, readable: true };
}

export function fillSteps(project: Project): number {
  return [...project.capture.ready, ...project.capture.steps].filter(
    (step) => step.kind === 'fill',
  ).length;
}

async function writeSummary(markdown: string) {
  const file = process.env.GITHUB_STEP_SUMMARY;

  if (file === undefined || file === '') {
    process.stderr.write(markdown);

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

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);

  if (command === 'preflight' && args.length === 1) {
    const project = Schema.decodeUnknownSync(
      Schema.fromJsonString(projectSchema),
    )(await readFile(path.join(args[0] ?? '.', 'observed.json'), 'utf8'));

    if (fillSteps(project) > 0) {
      await writeSummary(
        [
          '## Observed: not run',
          'This project fills form fields. This version of Observed writes fill values into the exported evidence, so the action does not run or upload projects with fill steps.',
        ].join('\n\n'),
      );
      process.stderr.write(
        'Observed: projects with fill steps are not supported in CI yet.\n',
      );
      process.exit(1);
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

    if (!summary.readable) {
      process.exit(1);
    }
  } else {
    process.stderr.write(
      'Usage: github-action.ts preflight <project> | summary <result.json> <exit-code> <artifact-name>\n',
    );
    process.exit(64);
  }
}
