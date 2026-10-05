import { Option, Schema } from 'effect';
import { scopeLine } from '../src/change-scope-text';
import type { Comparison, Side } from '../src/comparison-model';
import { shortSource } from '../src/provenance-text';
import {
  anchorLocation,
  executionLabels,
  headline,
  leadingChecks,
  runTone,
  type Tone,
} from '../src/result-text';
import {
  chatAction,
  checkCount,
  notObservedPaths,
  type ChatState,
} from './chat-delivery';
import type { Crops } from './screenshot-crops';
import type { SlackLinks } from './slack-delivery';

export class DiscordError extends Schema.TaggedError<DiscordError>()(
  'DiscordError',
  {
    message: Schema.String,
    code: Schema.String,
    gone: Schema.Boolean,
  },
) {}

// Unknown Channel and Unknown Message: the earlier message can no longer be
// edited. https://docs.discord.com/developers/topics/opcodes-and-status-codes
const goneCodes = ['10003', '10008'];
const missingPermissions = '50013';

const icons = {
  regression: '🔴',
  unknown: '⚠️',
  checked: '✅',
  neutral: '⚪',
} satisfies Record<Tone, string>;

// The light-theme foregrounds of DESIGN.md's evidence colors.
const colors = {
  regression: 0x9d3535,
  unknown: 0x506473,
  checked: 0x226348,
  neutral: 0x5e6c70,
} satisfies Record<Tone, number>;

// Mentions are also switched off with allowed_mentions; escaping keeps
// captured names from rendering as mentions, links or formatting.
export function discordText(value: string): string {
  return value.replace(/[\\*_~`|>[\]()<@]/g, '\\$&');
}

function code(value: string): string {
  return `\`${value.replaceAll('`', 'ˋ')}\``;
}

function clip(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

const httpsUrl = Schema.String.check(
  Schema.isPattern(/^https:\/\/[^\s<>()[\]]+$/),
);

// The angle brackets stop Discord from unfurling the link into a preview.
function discordLink(label: string, url: string | null): string | null {
  return url !== null && Schema.is(httpsUrl)(url)
    ? `[${discordText(label)}](<${url}>)`
    : null;
}

function revision(side: Side | undefined): string {
  if (side?.capture === null || side?.capture === undefined) {
    return 'unavailable';
  }

  const commit = code(shortSource(side.capture.manifest.source));

  return side.execution === 'complete'
    ? commit
    : `${commit} (${executionLabels[side.execution].toLowerCase()})`;
}

function location(result: Comparison): string {
  const [lead] = leadingChecks(result);
  const found =
    lead === undefined
      ? null
      : anchorLocation(lead.journey, lead.check, result.changeScope);

  return found === null ? '' : ` · ${found.words} ${code(found.place)}`;
}

function scopeText(result: Comparison): string[] {
  if (result.mode === 'preview') {
    return [];
  }

  const paths = notObservedPaths(result);
  const shown = paths.slice(0, 5).map(code).join(', ');
  const more = paths.length > 5 ? ` and ${paths.length - 5} more` : '';

  return [
    discordText(scopeLine(result.changeScope)),
    ...(paths.length === 0 ? [] : [`Not observed: ${shown}${more}`]),
  ];
}

function button(label: string, url: string | null) {
  return url !== null && Schema.is(httpsUrl)(url)
    ? [{ type: 2, style: 5, label, url }]
    : [];
}

const noResult = 'No result: treat this run as unavailable';

export const imageName = 'observed-screenshots.png';

// Like Slack, a message shows verdicts, check and metric names, measured
// numbers and revisions, never captured page text or error messages. The
// verdict line is the content, so it is what a notification shows.
export function discordMessage(
  result: Comparison | null,
  links: SlackLinks,
  image: { altText: string } | null,
) {
  const title = clip(result === null ? noResult : headline(result), 300);
  const tone = result === null ? 'unknown' : runTone(result);
  const where =
    discordLink(links.pullRequestLabel, links.pullRequest) ??
    discordText(links.pullRequestLabel);
  const [journey] = result?.journeys ?? [];
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
            : [discordText(clip(links.name, 200))]),
        ];
  const buttons = [
    ...(links.report === null
      ? button('Open run', links.run)
      : button('Open report', links.report)),
    ...button('View on PR', links.pullRequest),
  ];

  return {
    content: `${icons[tone]} **${discordText(title)}**${result === null ? '' : location(result)} · ${where}`,
    embeds: [
      {
        color: colors[tone],
        description: clip(
          [
            context.join(' · '),
            ...(result === null ? [] : scopeText(result)),
          ].join('\n'),
          4096,
        ),
        ...(image === null
          ? {}
          : { image: { url: `attachment://${imageName}` } }),
      },
    ],
    // Every edit lists the attachments to keep, so an edit without the image
    // removes the earlier run's crops.
    attachments:
      image === null
        ? []
        : [
            {
              id: 0,
              filename: imageName,
              description: clip(image.altText, 1024),
            },
          ],
    components: buttons.length === 0 ? [] : [{ type: 1, components: buttons }],
    allowed_mentions: { parse: [] },
  };
}

// A reply to the failing message, so the channel hears about the recovery;
// the edited message shows the current state.
export function discordRecovery(result: Comparison | null, messageId: string) {
  const head = result?.journeys[0]?.candidate;
  const title = clip(result === null ? noResult : headline(result), 300);
  const tone = result === null ? 'unknown' : runTone(result);

  return {
    content: `${icons[tone]} **${discordText(title)}** at ${revision(head)}${result === null ? '' : ` · ${checkCount(result)}`}`,
    message_reference: { message_id: messageId, fail_if_not_exists: false },
    allowed_mentions: { parse: [], replied_user: false },
  };
}

export type DiscordState = ChatState & { message: string };

const statePattern =
  /^<!-- observed-discord:(\d{17,20})\/(\d{17,20})\/(failing|passing) -->$/m;

export function readDiscordState(body: string | null): DiscordState | null {
  const match = body === null ? null : statePattern.exec(body);

  return match === null
    ? null
    : {
        channel: match[1] ?? '',
        message: match[2] ?? '',
        failing: match[3] === 'failing',
      };
}

export function writeDiscordState(state: DiscordState): string {
  return `<!-- observed-discord:${state.channel}/${state.message}/${state.failing ? 'failing' : 'passing'} -->`;
}

export function discordSkipReason(options: {
  token: string;
  channel: string;
  pullRequest: number | null;
  lookupFailed: boolean;
}): string | null {
  if (options.token === '' && options.channel === '') {
    return null;
  }

  if (options.token === '' || options.channel === '') {
    return 'Discord: set both discord-bot-token and discord-channel';
  }

  if (!/^\d{17,20}$/.test(options.channel)) {
    return 'Discord: discord-channel must be a channel ID such as 1553218437617033238';
  }

  if (options.pullRequest === null) {
    return 'Discord: posts only for pull requests';
  }

  return options.lookupFailed
    ? 'Discord: skipped because the earlier message could not be looked up'
    : null;
}

const snowflake = Schema.String.check(Schema.isPattern(/^\d{17,20}$/));

const messageSchema = Schema.Struct({ id: snowflake, channel_id: snowflake });

const errorSchema = Schema.Struct({ code: Schema.Number });

const rateLimitSchema = Schema.Struct({ retry_after: Schema.Number });

// Longer waits are reported instead of holding the job.
const longestRetry = 10;

type Upload = { bytes: Uint8Array };

function describe(status: number, code: string): string {
  if (status === 401) {
    return 'answered that the bot token is invalid';
  }

  if (code === missingPermissions || code === '50001') {
    return 'answered that the bot lacks a permission it needs in the channel';
  }

  return `answered HTTP ${String(status)}${code === '' ? '' : ` with Discord code ${code}`}`;
}

async function discordApi(
  label: string,
  request: {
    method: 'POST' | 'PATCH';
    path: string;
    token: string;
    payload: Record<string, unknown>;
    file: Upload | null;
  },
  retried = false,
): Promise<{ id: string; channel: string }> {
  let body: string | FormData;

  if (request.file === null) {
    body = JSON.stringify(request.payload);
  } else {
    body = new FormData();
    body.append('payload_json', JSON.stringify(request.payload));
    body.append(
      'files[0]',
      new Blob([Buffer.from(request.file.bytes)], { type: 'image/png' }),
      imageName,
    );
  }

  let response: Response;

  try {
    response = await fetch(`https://discord.com/api/v10${request.path}`, {
      method: request.method,
      headers: {
        Authorization: `Bot ${request.token}`,
        'User-Agent': 'DiscordBot (https://github.com/esau-morais/observed, 0)',
        ...(typeof body === 'string'
          ? { 'Content-Type': 'application/json' }
          : {}),
      },
      body,
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new DiscordError({
      message: `${label} did not answer`,
      code: 'no_answer',
      gone: false,
    });
  }

  const json: unknown = await response.json().catch(() => null);

  if (response.status === 429) {
    const wait = Schema.decodeUnknownOption(rateLimitSchema)(json);

    if (
      !retried &&
      Option.isSome(wait) &&
      wait.value.retry_after >= 0 &&
      wait.value.retry_after <= longestRetry
    ) {
      await new Promise((resolve) =>
        setTimeout(resolve, wait.value.retry_after * 1000),
      );

      return discordApi(label, request, true);
    }

    throw new DiscordError({
      message: `${label} was rate limited`,
      code: 'rate_limited',
      gone: false,
    });
  }

  if (!response.ok) {
    const error = Schema.decodeUnknownOption(errorSchema)(json);
    const reported = Option.isSome(error) ? String(error.value.code) : '';

    throw new DiscordError({
      message: `${label} ${describe(response.status, reported)}`,
      code: reported,
      gone: goneCodes.includes(reported),
    });
  }

  const message = Schema.decodeUnknownOption(messageSchema)(json);

  if (Option.isNone(message)) {
    throw new DiscordError({
      message: `${label} answered HTTP ${String(response.status)} unexpectedly`,
      code: 'unexpected',
      gone: false,
    });
  }

  return { id: message.value.id, channel: message.value.channel_id };
}

export type DiscordNote = { text: string; level: 'note' | 'warning' };

function failure(label: string, error: unknown): DiscordNote {
  return {
    text: `${label} failed. ${error instanceof DiscordError ? `${error.message}.` : 'An unexpected error.'}`,
    level: 'warning',
  };
}

export async function deliverDiscord(options: {
  token: string;
  channel: string;
  previous: DiscordState | null;
  result: Comparison | null;
  failing: boolean;
  links: SlackLinks;
  // Null when images are off or the result is not trusted.
  crops: (() => Promise<Crops>) | null;
}): Promise<{ state: DiscordState | null; notes: DiscordNote[] }> {
  const notes: DiscordNote[] = [];
  const action = chatAction(options.previous, options.channel, {
    failing: options.failing,
    passed: options.result?.conclusion.kind === 'no-regression',
  });

  if (action === 'none') {
    return {
      state: options.previous,
      notes: [
        {
          text: 'Discord: nothing sent for a result that is not failing',
          level: 'note',
        },
      ],
    };
  }

  let crops: Crops = { kind: 'none' };

  if (options.crops !== null) {
    try {
      crops = await options.crops();
    } catch (error) {
      notes.push(failure('The Discord image', error));
    }
  }

  if (crops.kind === 'mismatch') {
    notes.push({
      text: 'Discord: no image, because a screenshot does not match its recorded hash',
      level: 'warning',
    });
  }

  const earlier = action === 'post' ? null : options.previous;
  const send = (image: (Upload & { altText: string }) | null) => {
    const payload = discordMessage(options.result, options.links, image);

    return earlier === null
      ? discordApi('The Discord message', {
          method: 'POST',
          path: `/channels/${options.channel}/messages`,
          token: options.token,
          payload,
          file: image,
        })
      : discordApi('The Discord message', {
          method: 'PATCH',
          path: `/channels/${earlier.channel}/messages/${earlier.message}`,
          token: options.token,
          payload,
          file: image,
        }).catch((error: unknown) => {
          if (error instanceof DiscordError && error.gone && options.failing) {
            return discordApi('The Discord message', {
              method: 'POST',
              path: `/channels/${options.channel}/messages`,
              token: options.token,
              payload,
              file: image,
            });
          }

          throw error;
        });
  };

  const image = crops.kind === 'image' ? crops : null;
  let sent: { id: string; channel: string } | null = null;

  try {
    sent = await send(image);

    if (image !== null) {
      notes.push({
        text: 'Discord: showed the screenshot crops in the message',
        level: 'note',
      });
    }
  } catch (error) {
    // Attach Files is the permission a plain message does not need.
    if (
      image !== null &&
      error instanceof DiscordError &&
      error.code === missingPermissions
    ) {
      try {
        sent = await send(null);
        notes.push({
          text: 'Discord: no image, because the bot lacks Attach Files in the channel',
          level: 'warning',
        });
      } catch (retry) {
        notes.push(failure('The Discord message', retry));
      }
    } else {
      notes.push(failure('The Discord message', error));
    }
  }

  if (sent === null) {
    return { state: options.previous, notes };
  }

  const posted = earlier === null || sent.id !== earlier.message;

  notes.unshift({
    text: posted
      ? 'Discord: posted a message'
      : 'Discord: updated the earlier message',
    level: 'note',
  });

  if (action === 'recover' && !posted) {
    try {
      await discordApi('The Discord recovery reply', {
        method: 'POST',
        path: `/channels/${sent.channel}/messages`,
        token: options.token,
        payload: discordRecovery(options.result, sent.id),
        file: null,
      });
      notes.push({
        text: 'Discord: replied that it recovered',
        level: 'note',
      });
    } catch (error) {
      notes.push(failure('The Discord recovery reply', error));
    }
  }

  return {
    state: {
      channel: sent.channel,
      message: sent.id,
      failing: options.failing,
    },
    notes,
  };
}
