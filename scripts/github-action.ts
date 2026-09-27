import { BunServices } from '@effect/platform-bun';
import { Cause, Effect, Exit, Option, Schema } from 'effect';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  comparisonSchema,
  conclusionExitCodes,
  type Comparison,
  type Journey,
  type Side,
} from '../src/comparison-model';
import type { Capture, Source } from '../src/capture/model';
import { escapeText } from '../src/markdown';
import { loadProject } from '../src/project';
import { packageName, packaged } from '../src/installation';
import { renderReportPage } from '../src/report-page';
import {
  checkConclusion,
  checkName,
  commentMarker,
  DeliveryError,
  findComment,
  postCheckRun,
  writeComment,
} from './github-delivery';
import {
  callSlack,
  readSlackState,
  slackAction,
  slackMessage,
  SlackError,
  writeSlackState,
} from './slack-delivery';
import { describeRevision, shortSource } from '../src/provenance-text';
import { describeVisual } from '../src/visual-text';
import {
  checkSummary,
  conclusionTones,
  executionLabels,
  headline,
  verdictLabels,
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

// GitHub autolinks bare URLs even when their punctuation is escaped, and in a
// comment captured @mentions and #references would notify people or issues.
export function inlineText(value: string): string {
  return value
    .split(/(https?:\/\/[^\s`]+)/)
    .map((part, index) =>
      index % 2 === 1
        ? `\`${part.replace(/\.$/, '')}\`${part.endsWith('.') ? '.' : ''}`
        : escapeText(
            part.replaceAll('@', '@\u200b').replaceAll('#', '#\u200b'),
          ),
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

export function sideChecks(side: Side): string {
  if (side.execution !== 'complete') {
    return 'Unknown';
  }

  const passed = side.checks.filter(
    (check) => check.outcome === 'passed',
  ).length;

  return side.checks.length === 0
    ? 'None configured'
    : `${passed} of ${side.checks.length} passed`;
}

function sideRow(label: string, side: Side, repository: string | null) {
  return `| ${label} | ${revisionCell(side, repository)} | ${executionLabels[side.execution]} | ${sideChecks(side)} |`;
}

export function journeySides(
  result: Comparison,
  journey: Journey,
): [string, Side][] {
  const prefix =
    result.journeys.length === 1 ? '' : `${inlineText(journey.title)} · `;

  return result.mode === 'preview'
    ? [[`${prefix}Current`, journey.candidate]]
    : [
        [`${prefix}Base`, journey.base],
        [`${prefix}Candidate`, journey.candidate],
      ];
}

export function checkList(result: Comparison): string {
  const lines = result.journeys.flatMap((journey) =>
    journey.checks.map((check) => {
      const where =
        result.journeys.length === 1 ? '' : `${inlineText(journey.title)}: `;

      return `- **${verdictLabels[check.verdict]}** · ${where}${inlineText(check.name)}. Scope: ${inlineText(check.scope)}${check.verdict === 'passed' ? '' : ` ${inlineText(check.detail)}`}`;
    }),
  );

  return [`**${checkSummary(result)}.**`, ...lines].join('\n');
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

export type Summary = {
  markdown: string;
  trusted: boolean;
  title: string;
  kind: Kind | null;
};

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
  delivery?: string | null;
  headline?: boolean;
}): Summary {
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
  const bundle = `Raw evidence: workflow artifact \`${options.artifact.replaceAll('`', '')}\`. Download it and run \`bunx ${packageName}${packaged === null ? '' : `@${packaged.version}`} view <download>/run/report\`.`;
  const exit = `Observed exited with code ${formatExit(options.exitCode)}.`;
  const untrusted = (reason: string) => ({
    markdown: [
      alert('WARNING', [
        ...(options.headline === false
          ? []
          : ['**No result. Treat this run as unavailable, not passed.**']),
        `${reason} The job fails. The job log has details.`,
      ]),
      bundle,
      ...(options.delivery === undefined || options.delivery === null
        ? []
        : [options.delivery]),
    ].join('\n\n'),
    trusted: false,
    title: 'No result: treat this run as unavailable',
    kind: null,
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
  const labelled = result.journeys.flatMap((journey) =>
    journeySides(result, journey),
  );
  const failures = labelled.flatMap(([label, side]) =>
    describeFailure(label, side.capture?.manifest.execution),
  );
  const reasons =
    failures.length > 0
      ? failures
      : result.journeys.flatMap((journey) =>
          journey.comparison.kind === 'unavailable'
            ? journey.comparison.reasons.map(
                (reason) =>
                  `- ${result.journeys.length === 1 ? '' : `${inlineText(journey.title)}: `}${inlineText(reason)}`,
              )
            : [],
        );
  const visuals = result.journeys.flatMap((journey) =>
    journey.comparison.kind === 'available' &&
    (journey.comparison.visual.kind === 'changed' ||
      journey.comparison.visual.kind === 'size-differs')
      ? [
          `Screenshots${result.journeys.length === 1 ? '' : ` (${inlineText(journey.title)})`}: ${inlineText(describeVisual(journey.comparison.visual))} An observation, not a check.`,
        ]
      : [],
  );
  const revisions = labelled.flatMap(([label, side]) =>
    side.capture === null
      ? []
      : [
          `${label}: \`${describeRevision(side.capture.manifest.source.revision)}\``,
        ],
  );
  const limitations = [
    ...new Set(result.journeys.flatMap((journey) => journey.limitations)),
  ];

  const markdown = [
    alert(alerts[conclusionTones[kind]], [
      ...(options.headline === false
        ? []
        : [`**${inlineText(headline(result))}**`]),
      `${inlineText(result.conclusion.text.replace(/\.?$/, '.'))} ${consequences[kind]}`,
    ]),
    [
      '| | Revision | Capture | Checks |',
      '| --- | --- | --- | --- |',
      ...labelled.map(([label, side]) => sideRow(label, side, repository)),
    ].join('\n'),
    ...(reasons.length === 0 ? [] : [reasons.join('\n')]),
    ...(result.summary.total === 0 ? [] : [checkList(result)]),
    ...visuals,
    ...(page === null ? [] : [`**[Open the report](${page})**`]),
    ...(page === null ? [`No report page was uploaded. ${bundle}`] : []),
    collapsed('Limits and raw evidence', [
      ...(failures.length > 0
        ? result.journeys.flatMap((journey) =>
            journey.comparison.kind === 'unavailable'
              ? journey.comparison.reasons.map(inlineText)
              : [],
          )
        : []),
      ...limitations.map(inlineText),
      ...revisions,
      ...(page === null
        ? []
        : [
            'The report opens for signed-in users who can read this repository, until the artifact expires.',
            bundle,
          ]),
      ...(options.delivery === undefined || options.delivery === null
        ? []
        : [options.delivery]),
      exit,
    ]),
  ].join('\n\n');

  return { markdown, trusted: true, title: headline(result), kind };
}

export function deliveryNote(options: {
  note: string;
  configured: boolean;
  untrustedSource: boolean;
  tokenOutcome: string;
}): string | null {
  if (options.note !== '') {
    return options.note;
  }

  if (options.untrustedSource) {
    return 'Nothing was posted to GitHub or Slack: pull requests from forks and Dependabot receive no secrets.';
  }

  if (!options.configured) {
    return null;
  }

  return options.tokenOutcome === 'failure'
    ? 'Nothing was posted: the GitHub App token could not be created. The job log has details.'
    : 'Nothing was posted: the GitHub App client ID or private key, or the Slack bot token, is missing.';
}

export function slackSkipReason(options: {
  token: string;
  channel: string;
  pullRequest: number | null;
  lookupFailed: boolean;
}): string | null {
  if (options.token === '' && options.channel === '') {
    return null;
  }

  if (options.token === '' || options.channel === '') {
    return 'Slack: set both slack-bot-token and slack-channel';
  }

  if (!/^[CGD][A-Z0-9]+$/.test(options.channel)) {
    return 'Slack: slack-channel must be a channel ID such as C0123456789';
  }

  if (options.pullRequest === null) {
    return 'Slack: posts only for pull requests';
  }

  return options.lookupFailed
    ? 'Slack: skipped because the earlier message could not be looked up'
    : null;
}

export function capturedRevision(
  revision: Source['revision'] | null,
  commits: readonly string[],
): 'match' | 'unavailable' | 'other' {
  if (revision === null) {
    return 'unavailable';
  }

  return revision.kind === 'commit' && commits.includes(revision.commit)
    ? 'match'
    : 'other';
}

// Every journey captures the same candidate; one at another revision means the
// result does not belong to this pull request.
export function candidateIdentity(
  result: Comparison,
  commits: readonly string[],
): 'match' | 'unavailable' | 'other' {
  const identities = result.journeys.map((journey) =>
    capturedRevision(
      journey.candidate.capture?.manifest.source.revision ?? null,
      commits,
    ),
  );

  if (identities.includes('other')) {
    return 'other';
  }

  return identities.includes('match') ? 'match' : 'unavailable';
}

function link(label: string, url: string | null): string | null {
  return url !== null && Schema.is(httpsUrlSchema)(url)
    ? `[${label}](${url})`
    : null;
}

async function writeOutput(name: string, value: string) {
  const file = process.env.GITHUB_OUTPUT;

  if (file !== undefined && file !== '') {
    await appendFile(file, `${name}=${value.replace(/[\r\n]+/g, ' ')}\n`);
  }
}

function environment(name: string): string {
  return process.env[name] ?? '';
}

function repositoryUrl(): string | null {
  const server = environment('GITHUB_SERVER_URL');
  const repository = environment('GITHUB_REPOSITORY');

  return server === '' || repository === '' ? null : `${server}/${repository}`;
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
  } else if (command === 'deliver' && args.length === 4) {
    const [resultFile = '', exitCode = '', artifact = '', page = ''] = args;
    const output = await readOptional(resultFile);
    const repository = repositoryUrl();
    const summary = summarize({
      output,
      exitCode: Option.getOrNull(
        Schema.decodeUnknownOption(exitCodeSchema)(exitCode),
      ),
      artifact,
      page: page === '' ? null : page,
      repository,
    });
    const headSha = environment('OBSERVED_HEAD_SHA');
    const decoded =
      output === null
        ? Option.none()
        : Schema.decodeUnknownOption(runOutputSchema)(output);
    const identity = Option.isNone(decoded)
      ? 'unavailable'
      : candidateIdentity(decoded.value.result, [
          headSha,
          environment('GITHUB_SHA'),
        ]);

    if (identity === 'other') {
      await writeOutput(
        'note',
        `Nothing was posted to GitHub or Slack: the candidate capture is not pull request head ${headSha.slice(0, 7)} or its merge commit.`,
      );
      process.exit(0);
    }

    const pullRequest = Number(environment('OBSERVED_PULL_REQUEST'));
    const runUrl = `${repository ?? ''}/actions/runs/${environment('GITHUB_RUN_ID')}`;
    const target = {
      api:
        environment('GITHUB_API_URL') === ''
          ? 'https://api.github.com'
          : environment('GITHUB_API_URL'),
      repository: environment('GITHUB_REPOSITORY'),
      token: environment('OBSERVED_GITHUB_TOKEN'),
      headSha,
      pullRequest:
        Number.isInteger(pullRequest) && pullRequest > 0 ? pullRequest : null,
      detailsUrl: Schema.is(httpsUrlSchema)(page) ? page : runUrl,
      botLogin: `${environment('OBSERVED_APP_SLUG')}[bot]`,
    };
    const github = target.token !== '';
    const slackToken = environment('OBSERVED_SLACK_BOT_TOKEN');
    const slackChannel = environment('OBSERVED_SLACK_CHANNEL');
    const notes: string[] = [];
    const attempt = async <A>(
      label: string,
      send: () => Promise<A>,
    ): Promise<A | null> => {
      try {
        return await send();
      } catch (error) {
        const reason =
          error instanceof DeliveryError || error instanceof SlackError
            ? error.message
            : 'an unexpected error';

        process.stdout.write(
          `::warning title=Observed::Posting the ${label} failed: ${reason}\n`,
        );
        notes.push(`the ${label} failed (${reason})`);

        return null;
      }
    };

    const name = checkName(artifact);
    const marker = commentMarker(artifact);
    const checkUrl = github
      ? await attempt('GitHub check', () =>
          postCheckRun(target, {
            name,
            title: summary.title,
            markdown: summarize({
              output,
              exitCode: Option.getOrNull(
                Schema.decodeUnknownOption(exitCodeSchema)(exitCode),
              ),
              artifact,
              page: page === '' ? null : page,
              repository,
              headline: false,
            }).markdown,
            conclusion: checkConclusion(summary.kind),
          }),
        )
      : null;
    const lookup = github
      ? await attempt('pull request comment', async () => ({
          comment: await findComment(target, marker),
        }))
      : null;
    const lookupFailed = github && lookup === null;
    const existing = lookup?.comment ?? null;
    let slackState = readSlackState(existing?.body ?? null);

    const slackSkip = slackSkipReason({
      token: slackToken,
      channel: slackChannel,
      pullRequest: target.pullRequest,
      lookupFailed,
    });

    if (slackSkip !== null) {
      notes.push(slackSkip);
    } else if (slackToken !== '') {
      const failing = checkConclusion(summary.kind) === 'failure';
      const action = slackAction(slackState, slackChannel, failing);
      const message = slackMessage(
        summary.trusted && Option.isSome(decoded) ? decoded.value.result : null,
        {
          name,
          pullRequest:
            target.pullRequest === null || repository === null
              ? null
              : `${repository}/pull/${String(target.pullRequest)}`,
          pullRequestLabel:
            target.pullRequest === null
              ? target.repository
              : `${target.repository}#${String(target.pullRequest)}`,
          report: Schema.is(httpsUrlSchema)(page) ? page : null,
          check: checkUrl,
          run: runUrl,
        },
      );

      if (action === 'none') {
        notes.push('Slack: nothing sent for a result that is not failing');
      } else {
        const sent = await attempt('Slack message', () =>
          action === 'post' || slackState === null
            ? callSlack('chat.postMessage', slackToken, {
                channel: slackChannel,
                ...message,
                unfurl_links: false,
                unfurl_media: false,
              })
            : callSlack('chat.update', slackToken, {
                channel: slackState.channel,
                ts: slackState.ts,
                ...message,
              }).catch((error: unknown) => {
                if (error instanceof SlackError && error.gone && failing) {
                  return callSlack('chat.postMessage', slackToken, {
                    channel: slackChannel,
                    ...message,
                    unfurl_links: false,
                    unfurl_media: false,
                  });
                }

                throw error;
              }),
        );

        if (sent !== null) {
          slackState = { channel: sent.channel, ts: sent.ts, failing };
          notes.push(
            action === 'post'
              ? 'Slack: posted a message'
              : 'Slack: updated the earlier message',
          );
        }
      }
    }

    const commentUrl =
      github && !lookupFailed
        ? await attempt('pull request comment', () =>
            writeComment(
              target,
              existing,
              marker,
              [
                ...(slackState === null ? [] : [writeSlackState(slackState)]),
                ...(name === 'Observed'
                  ? []
                  : [`<sub>${inlineText(name)}</sub>`, '']),
                summary.markdown,
              ].join('\n'),
            ),
          )
        : null;

    await writeOutput(
      'note',
      `Delivery: ${[
        link('GitHub check', checkUrl),
        link('pull request comment', commentUrl),
        ...notes,
      ]
        .filter((item) => item !== null)
        .join('; ')}.`,
    );
  } else if (command === 'summary' && args.length === 4) {
    const [resultFile = '', exitCode = '', artifact = '', page = ''] = args;
    const summary = summarize({
      output: await readOptional(resultFile),
      exitCode: Option.getOrNull(
        Schema.decodeUnknownOption(exitCodeSchema)(exitCode),
      ),
      artifact,
      page: page === '' ? null : page,
      repository: repositoryUrl(),
      delivery: deliveryNote({
        note: environment('OBSERVED_DELIVERY_NOTE'),
        configured: environment('OBSERVED_APP_CONFIGURED') === 'true',
        untrustedSource: environment('OBSERVED_UNTRUSTED_SOURCE') === 'true',
        tokenOutcome: environment('OBSERVED_APP_TOKEN_OUTCOME'),
      }),
    });

    await writeSummary(summary.markdown);

    if (!summary.trusted) {
      process.exit(1);
    }
  } else {
    process.stderr.write(
      'Usage: github-action.ts preflight <project> | page <report-directory> <result.json> <output.html> | summary|deliver <result.json> <exit-code> <artifact-name> <page-url>\n',
    );
    process.exit(64);
  }
}
