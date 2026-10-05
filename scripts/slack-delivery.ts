import { Option, Schema } from 'effect';
import { scopeLine } from '../src/change-scope-text';
import type { Comparison, Side } from '../src/comparison-model';
import { shortSource } from '../src/provenance-text';
import {
  anchorLocation,
  runTone,
  executionLabels,
  headline,
  leadingChecks,
  type Tone,
} from '../src/result-text';
import { checkCount, notObservedPaths } from './chat-delivery';

export class SlackError extends Schema.TaggedError<SlackError>()('SlackError', {
  message: Schema.String,
  code: Schema.String,
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
  run: string | null;
};

function revision(side: Side | undefined): string {
  if (side?.capture === null || side?.capture === undefined) {
    return 'unavailable';
  }

  const commit = `\`${slackText(shortSource(side.capture.manifest.source))}\``;

  return side.execution === 'complete'
    ? commit
    : `${commit} (${executionLabels[side.execution].toLowerCase()})`;
}

function scopeText(result: Comparison): string[] {
  if (result.mode === 'preview') {
    return [];
  }

  const paths = notObservedPaths(result);
  const shown = paths
    .slice(0, 5)
    .map((path) => `\`${slackText(path)}\``)
    .join(', ');
  const more = paths.length > 5 ? ` and ${paths.length - 5} more` : '';

  return [
    slackText(scopeLine(result.changeScope)),
    ...(paths.length === 0 ? [] : [`Not observed: ${shown}${more}`]),
  ];
}

function button(text: string, url: string | null, id: string) {
  return url !== null && Schema.is(httpsUrl)(url)
    ? [
        {
          type: 'button',
          action_id: id,
          text: { type: 'plain_text', text },
          url,
        },
      ]
    : [];
}

// Channels can reach people who can't read the repository, so a message shows
// verdicts, check and metric names, measured numbers and revisions, never
// captured page text or error messages.
// The deciding check's source location, as the GitHub row states it.
function location(result: Comparison): string {
  const [lead] = leadingChecks(result);
  const found =
    lead === undefined
      ? null
      : anchorLocation(lead.journey, lead.check, result.changeScope);

  return found === null
    ? ''
    : ` · ${found.words} \`${slackText(found.place)}\``;
}

export function slackMessage(result: Comparison | null, links: SlackLinks) {
  const title = clip(
    result === null
      ? 'No result: treat this run as unavailable'
      : headline(result),
    300,
  );
  const icon = result === null ? icons.unknown : icons[runTone(result)];
  const where =
    slackLink(links.pullRequestLabel, links.pullRequest) ??
    slackText(links.pullRequestLabel);
  const [journey] = result?.journeys ?? [];
  const buttons = [
    ...(links.report === null
      ? button('Open run', links.run, 'open_run')
      : button('Open report', links.report, 'open_report')),
    ...button('View on PR', links.pullRequest, 'view_pull_request'),
  ];
  const context =
    result === null
      ? ['Observed wrote no readable result']
      : [
          result.mode === 'preview'
            ? revision(journey?.candidate)
            : `${revision(journey?.base)} → ${revision(journey?.candidate)}`,
          checkCount(result),
          ...(links.name === 'Observed'
            ? []
            : [slackText(clip(links.name, 200))]),
        ];

  return {
    text: slackText(`${title} · ${links.pullRequestLabel}`),
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${icon} *${slackText(title)}*${result === null ? '' : location(result)} · ${where}`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: [
              context.join(' · '),
              ...(result === null ? [] : scopeText(result)),
            ].join('\n'),
          },
        ],
      },
      ...(buttons.length === 0 ? [] : [{ type: 'actions', elements: buttons }]),
    ],
  };
}

// Posted in the thread of the failing message, so the people following it
// hear about the recovery; the edited parent shows the current state.
export function slackRecovery(result: Comparison | null) {
  const head = result?.journeys[0]?.candidate;
  const title =
    result === null
      ? 'No result: treat this run as unavailable'
      : headline(result);
  const icon = result === null ? icons.unknown : icons[runTone(result)];

  return {
    text: `${icon} *${slackText(clip(title, 300))}* at ${revision(head)}${result === null ? '' : ` · ${checkCount(result)}`}`,
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

const answerSchema = Schema.Struct({
  ok: Schema.Boolean,
  error: Schema.optionalKey(Schema.String),
});

const messageSchema = Schema.Struct({
  ts: Schema.String.check(Schema.isPattern(/^\d+\.\d+$/)),
  channel: Schema.String.check(Schema.isPattern(/^[A-Z0-9]+$/)),
});

const uploadSchema = Schema.Struct({
  upload_url: Schema.String.check(Schema.isPattern(/^https:\/\/[^\s]+$/)),
  file_id: Schema.String.check(Schema.isPattern(/^[A-Z0-9]+$/)),
});

type Body =
  | { kind: 'json'; value: Record<string, unknown> }
  | { kind: 'form'; value: Record<string, string> };

async function slackApi<A>(
  method: string,
  token: string,
  body: Body,
  schema: Schema.Codec<A>,
): Promise<A> {
  let response: Response;

  try {
    response = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type':
          body.kind === 'json'
            ? 'application/json; charset=utf-8'
            : 'application/x-www-form-urlencoded',
      },
      body:
        body.kind === 'json'
          ? JSON.stringify(body.value)
          : new URLSearchParams(body.value).toString(),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new SlackError({
      message: `${method} did not answer`,
      code: 'no_answer',
      gone: false,
    });
  }

  const json: unknown = await response.json().catch(() => null);
  const answer = Schema.decodeUnknownOption(answerSchema)(json);

  if (Option.isNone(answer)) {
    throw new SlackError({
      message: `${method} answered HTTP ${String(response.status)} unexpectedly`,
      code: 'unexpected',
      gone: false,
    });
  }

  const decoded = answer.value.ok
    ? Schema.decodeUnknownOption(schema)(json)
    : Option.none();

  if (Option.isNone(decoded)) {
    const reported = answer.value.error ?? '';
    let error = 'unexpected_answer';

    if (!answer.value.ok) {
      error = /^[a-z_]+$/.test(reported) ? reported : 'unknown_error';
    }

    throw new SlackError({
      message: `${method} answered ${error}`,
      code: error,
      gone: goneErrors.includes(error),
    });
  }

  return decoded.value;
}

export function callSlack(
  method: 'chat.postMessage' | 'chat.update',
  token: string,
  body: Record<string, unknown>,
): Promise<{ channel: string; ts: string }> {
  return slackApi(method, token, { kind: 'json', value: body }, messageSchema);
}

// Needs the optional files:write scope. Without it Slack answers
// missing_scope, and the message goes out without the image.
export async function uploadSlackImage(
  token: string,
  image: {
    channel: string;
    threadTs: string;
    filename: string;
    title: string;
    altText: string;
    bytes: Uint8Array;
  },
): Promise<'uploaded' | 'missing-scope'> {
  let upload: typeof uploadSchema.Type;

  try {
    upload = await slackApi(
      'files.getUploadURLExternal',
      token,
      {
        kind: 'form',
        value: {
          filename: image.filename,
          length: String(image.bytes.length),
          alt_txt: image.altText,
        },
      },
      uploadSchema,
    );
  } catch (error) {
    if (error instanceof SlackError && error.code === 'missing_scope') {
      return 'missing-scope';
    }

    throw error;
  }

  let stored: Response;

  try {
    stored = await fetch(upload.upload_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Blob([Buffer.from(image.bytes)]),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new SlackError({
      message: 'the file upload did not answer',
      code: 'no_answer',
      gone: false,
    });
  }

  // The upload URL answers 200 on success; the reference treats anything
  // else as a failure.
  if (stored.status !== 200) {
    throw new SlackError({
      message: `the file upload answered HTTP ${String(stored.status)}`,
      code: 'upload_failed',
      gone: false,
    });
  }

  await slackApi(
    'files.completeUploadExternal',
    token,
    {
      kind: 'form',
      value: {
        files: JSON.stringify([{ id: upload.file_id, title: image.title }]),
        channel_id: image.channel,
        thread_ts: image.threadTs,
      },
    },
    Schema.Struct({}),
  );

  return 'uploaded';
}
