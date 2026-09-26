import { Option, Schema } from 'effect';
import type { Comparison, Side } from '../src/comparison-model';
import { shortSource } from '../src/provenance-text';
import {
  checkLabels,
  conclusionTones,
  executionLabels,
  headline,
  type Tone,
} from '../src/result-text';

export class SlackError extends Schema.TaggedError<SlackError>()('SlackError', {
  message: Schema.String,
  gone: Schema.Boolean,
}) {}

// These chat.update errors mean the earlier message can no longer be edited.
const goneErrors = [
  'message_not_found',
  'cant_update_message',
  'channel_not_found',
  'edit_window_closed',
];

const icons = {
  regression: ':red_circle:',
  unknown: ':warning:',
  checked: ':white_check_mark:',
  neutral: ':white_circle:',
} satisfies Record<Tone, string>;

// Slack channels can reach people who can't read the repository, so the
// message carries outcomes and links, never captured values.
const consequences = {
  regression: 'The job fails.',
  'check-failed': 'The job fails.',
  unavailable: 'Missing evidence is not a pass. The job fails.',
  'no-regression': 'The job passes.',
  'not-checked': 'No named check ran. The job passes.',
  preview: 'A preview compares no revisions. The job passes.',
} satisfies Record<Comparison['conclusion']['kind'], string>;

// Slack reads <...> as links and mentions, so captured text must not keep them.
export function slackText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function clip(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

const httpsUrl = Schema.String.check(Schema.isPattern(/^https:\/\/[^\s<>|]+$/));

function slackLink(label: string, url: string | null): string | null {
  return url !== null && Schema.is(httpsUrl)(url)
    ? `<${url}|${slackText(label).replaceAll('|', '/')}>`
    : null;
}

export type SlackLinks = {
  name: string;
  pullRequest: string | null;
  pullRequestLabel: string;
  report: string | null;
  check: string | null;
  run: string | null;
};

function sideLine(label: string, side: Side): string {
  const revision =
    side.capture === null
      ? 'unavailable'
      : `\`${slackText(shortSource(side.capture.manifest.source))}\``;

  return `${label} ${revision} ${executionLabels[side.execution].toLowerCase()}, check ${checkLabels[side.check.outcome].toLowerCase()}`;
}

export function slackMessage(result: Comparison | null, links: SlackLinks) {
  const title = clip(
    result === null
      ? 'No result: treat this run as unavailable'
      : headline(result),
    300,
  );
  const icon =
    result === null
      ? icons.unknown
      : icons[conclusionTones[result.conclusion.kind]];
  const detail =
    result === null
      ? 'Observed wrote no readable result. The job fails.'
      : consequences[result.conclusion.kind];
  const where =
    slackLink(links.pullRequestLabel, links.pullRequest) ??
    slackText(links.pullRequestLabel);
  const run =
    links.name === 'Observed' ? '' : ` · ${slackText(clip(links.name, 200))}`;
  const labelled: [string, Side][] = [];

  if (result?.mode === 'preview') {
    labelled.push(['Current', result.candidate]);
  } else if (result !== null) {
    labelled.push(['Base', result.base], ['Candidate', result.candidate]);
  }

  const context: string[] = [];

  for (const item of [
    ...labelled.map(([label, side]) => sideLine(label, side)),
    slackLink('Open the report', links.report),
    slackLink('GitHub check', links.check),
    slackLink('Workflow run', links.run),
  ]) {
    if (item !== null && [...context, item].join(' · ').length <= 2900) {
      context.push(item);
    }
  }

  return {
    text: slackText(`${title} · ${links.pullRequestLabel}`),
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${icon} *${slackText(title)}* · ${where}${run}\n${detail}`,
        },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: context.join(' · ') }],
      },
    ],
  };
}

export type SlackState = { channel: string; ts: string; failing: boolean };

const statePattern =
  /^<!-- observed-slack:([A-Z0-9]+)\/(\d+\.\d+)\/(failing|passing) -->$/m;

export function readSlackState(body: string | null): SlackState | null {
  const match = body === null ? null : statePattern.exec(body);

  return match === null
    ? null
    : {
        channel: match[1] ?? '',
        ts: match[2] ?? '',
        failing: match[3] === 'failing',
      };
}

export function writeSlackState(state: SlackState): string {
  return `<!-- observed-slack:${state.channel}/${state.ts}/${state.failing ? 'failing' : 'passing'} -->`;
}

// Edits notify nobody, so only a newly failing result posts a new message.
export function slackAction(
  previous: SlackState | null,
  channel: string,
  failing: boolean,
): 'post' | 'update' | 'none' {
  const known = previous?.channel === channel ? previous : null;

  if (failing && (known === null || !known.failing)) {
    return 'post';
  }

  return known === null ? 'none' : 'update';
}

const slackResponse = Schema.Struct({
  ok: Schema.Boolean,
  ts: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^\d+\.\d+$/))),
  channel: Schema.optionalKey(
    Schema.String.check(Schema.isPattern(/^[A-Z0-9]+$/)),
  ),
  error: Schema.optionalKey(Schema.String),
});

export async function callSlack(
  method: 'chat.postMessage' | 'chat.update',
  token: string,
  body: Record<string, unknown>,
): Promise<{ channel: string; ts: string }> {
  let response: Response;

  try {
    response = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new SlackError({ message: `${method} did not answer`, gone: false });
  }

  const decoded = Schema.decodeUnknownOption(slackResponse)(
    await response.json().catch(() => null),
  );

  if (Option.isNone(decoded)) {
    throw new SlackError({
      message: `${method} answered HTTP ${String(response.status)} unexpectedly`,
      gone: false,
    });
  }

  const answer = decoded.value;

  if (!answer.ok || answer.ts === undefined || answer.channel === undefined) {
    const error = /^[a-z_]+$/.test(answer.error ?? '')
      ? (answer.error ?? '')
      : 'unknown_error';

    throw new SlackError({
      message: `${method} answered ${error}`,
      gone: goneErrors.includes(error),
    });
  }

  return { channel: answer.channel, ts: answer.ts };
}
