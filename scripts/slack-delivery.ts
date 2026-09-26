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
}) {}

const icons = {
  regression: ':red_circle:',
  unknown: ':warning:',
  checked: ':white_check_mark:',
  neutral: ':white_circle:',
} satisfies Record<Tone, string>;

// Slack reads <...> as links and mentions, so captured text must not keep them.
export function slackText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

const httpsUrl = Schema.String.check(Schema.isPattern(/^https:\/\/[^\s<>|]+$/));

function slackLink(label: string, url: string | null): string | null {
  return url !== null && Schema.is(httpsUrl)(url)
    ? `<${url}|${slackText(label).replaceAll('|', '/')}>`
    : null;
}

export type SlackLinks = {
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
  const title =
    result === null
      ? 'No result: treat this run as unavailable'
      : headline(result);
  const icon =
    result === null
      ? icons.unknown
      : icons[conclusionTones[result.conclusion.kind]];
  const where =
    slackLink(links.pullRequestLabel, links.pullRequest) ??
    slackText(links.pullRequestLabel);
  const labelled: [string, Side][] = [];

  if (result?.mode === 'preview') {
    labelled.push(['Current', result.candidate]);
  } else if (result !== null) {
    labelled.push(['Base', result.base], ['Candidate', result.candidate]);
  }

  const sides = labelled.map(([label, side]) => sideLine(label, side));
  const actions = [
    slackLink('Open the report', links.report),
    slackLink('GitHub check', links.check),
    slackLink('Workflow run', links.run),
  ].filter((item) => item !== null);
  const detail =
    result === null
      ? 'Observed wrote no readable result. The job fails.'
      : result.conclusion.text;

  return {
    text: `${title} · ${links.pullRequestLabel}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${icon} *${slackText(title)}* · ${where}\n${slackText(detail).slice(0, 2500)}`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: [...sides, ...actions].join(' · ').slice(0, 2900),
          },
        ],
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
  ts: Schema.optionalKey(Schema.String),
  channel: Schema.optionalKey(Schema.String),
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
    throw new SlackError({ message: `${method} did not answer` });
  }

  const decoded = Schema.decodeUnknownOption(slackResponse)(
    await response.json().catch(() => null),
  );

  if (Option.isNone(decoded)) {
    throw new SlackError({
      message: `${method} answered HTTP ${String(response.status)} unexpectedly`,
    });
  }

  const answer = decoded.value;

  if (!answer.ok || answer.ts === undefined || answer.channel === undefined) {
    const error = /^[a-z_]+$/.test(answer.error ?? '')
      ? (answer.error ?? '')
      : 'unknown_error';

    throw new SlackError({ message: `${method} answered ${error}` });
  }

  return { channel: answer.channel, ts: answer.ts };
}
