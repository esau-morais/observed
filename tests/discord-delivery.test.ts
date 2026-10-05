import { Effect } from 'effect';
import { afterEach, expect, test, vi } from 'vitest';
import {
  deliverDiscord,
  discordMessage,
  discordSkipReason,
  readDiscordState,
  writeDiscordState,
} from '../scripts/discord-delivery';
import { compareCaptures, inspectSide } from '../src/comparison';

const evaluatedAt = '2026-09-26T12:00:00.000Z';
const channel = '1553218437617033238';
const earlier = '1556506147849113653';
const later = '1556506147849113999';
const links = {
  name: 'Observed',
  pullRequest: 'https://github.com/o/r/pull/7',
  pullRequestLabel: 'o/r#7',
  report: 'https://github.com/o/r/actions/runs/1/artifacts/2',
  run: 'https://github.com/o/r/actions/runs/1',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

async function unavailable() {
  const missing = await Effect.runPromise(
    inspectSide({ directory: null, prefix: 'candidate', evaluatedAt }),
  );

  return compareCaptures({
    base: missing,
    candidate: missing,
    evaluatedAt,
    visual: { kind: 'unavailable', reason: 'No captures' },
  });
}

type Call = {
  method: string;
  url: string;
  payload: unknown;
  file: Blob | null;
};

// Answers in the shapes documented at
// https://docs.discord.com/developers/resources/message#create-message and
// https://docs.discord.com/developers/topics/opcodes-and-status-codes
function discord(answers: (() => Response)[]): Call[] {
  const calls: Call[] = [];

  vi.stubGlobal('fetch', (target: string | URL, init: RequestInit) => {
    let payload: unknown = null;
    let file: Blob | null = null;

    if (init.body instanceof FormData) {
      const json = init.body.get('payload_json');
      const part = init.body.get('files[0]');

      payload = typeof json === 'string' ? JSON.parse(json) : null;
      file = part instanceof Blob ? part : null;
    } else if (typeof init.body === 'string') {
      payload = JSON.parse(init.body);
    }

    calls.push({
      method: init.method ?? 'GET',
      url: String(target),
      payload,
      file,
    });

    const answer = answers.shift();

    return Promise.resolve(
      answer === undefined ? new Response(null, { status: 500 }) : answer(),
    );
  });

  return calls;
}

const message = (id: string) => () =>
  Response.json({ id, channel_id: channel, content: '' });
const refused = (status: number, code: number) => () =>
  Response.json({ message: 'refused', code }, { status });

test('captured names cannot mention anyone or format the Discord message, and captured values stay out', async () => {
  const result = await unavailable();
  const [journey] = result.journeys;
  const verdict = {
    id: 'total',
    name: 'Order total @everyone <@123> [x](https://evil.test) **',
    scope: 'One checkout',
    expectation: 'Exactly one .total element.',
  };
  const payload = discordMessage(
    {
      ...result,
      journeys: [
        {
          ...journey,
          checks: [
            {
              ...verdict,
              verdict: 'unknown',
              detail: 'Captured item text',
            },
          ],
        },
      ],
      summary: { passed: 0, total: 1 },
      conclusion: { kind: 'unavailable', text: 'Captured page text' },
    },
    links,
    null,
  );
  const text = JSON.stringify(payload);

  expect(payload.allowed_mentions).toEqual({ parse: [] });
  expect(payload.content).toContain(
    'Order total \\@everyone \\<\\@123\\> \\[x\\]\\(https://evil.test\\) \\*\\*',
  );
  expect(payload.content).toMatch(/^⚠️ /);
  expect(payload.content).toContain('[o/r#7](<https://github.com/o/r/pull/7>)');
  expect(text).toContain('1 of 1 check unknown');
  expect(text).not.toContain('Captured');
});

test('an unreadable result never gets a passing icon or color in Discord', () => {
  const payload = discordMessage(null, links, null);

  expect(payload.content).toMatch(/^⚠️ \*\*No result/);
  expect(payload.embeds[0]?.color).toBe(0x506473);
});

test('the Discord message identity stored in a comment round-trips and ignores malformed markers', () => {
  const state = { channel, message: earlier, failing: true };

  expect(readDiscordState(`x\n${writeDiscordState(state)}\ny`)).toEqual(state);
  expect(
    readDiscordState(`<!-- observed-discord:${channel}/<b>/failing -->`),
  ).toBeNull();
  expect(readDiscordState(null)).toBeNull();
});

test('Discord is skipped with a reason instead of posting to a guessed channel', () => {
  const reason = (options: Partial<Parameters<typeof discordSkipReason>[0]>) =>
    discordSkipReason({
      token: 'token',
      channel,
      pullRequest: 7,
      lookupFailed: false,
      ...options,
    });

  expect(reason({})).toBeNull();
  expect(reason({ token: '', channel: '' })).toBeNull();
  expect(reason({ channel: '' })).toContain('set both');
  expect(reason({ channel: '#general' })).toContain('channel ID');
  expect(reason({ pullRequest: null })).toContain('only for pull requests');
  expect(reason({ lookupFailed: true })).toContain('could not be looked up');
});

const crops = () =>
  Promise.resolve({
    kind: 'image' as const,
    bytes: new Uint8Array([1, 2, 3]),
    altText: 'Before, after and changed pixels',
  });

test('a newly failing result posts one message with the crops attached and referenced by the embed', async () => {
  const calls = discord([message(earlier)]);
  const delivered = await deliverDiscord({
    token: 'bot',
    channel,
    previous: null,
    result: null,
    failing: true,
    links,
    crops,
  });

  expect(calls).toHaveLength(1);
  expect(calls[0]?.method).toBe('POST');
  expect(calls[0]?.url).toBe(
    `https://discord.com/api/v10/channels/${channel}/messages`,
  );
  expect(calls[0]?.file?.size).toBe(3);
  expect(calls[0]?.payload).toMatchObject({
    embeds: [{ image: { url: 'attachment://observed-screenshots.png' } }],
    attachments: [{ id: 0, filename: 'observed-screenshots.png' }],
    allowed_mentions: { parse: [] },
  });
  expect(delivered.state).toEqual({ channel, message: earlier, failing: true });
});

test('a later run edits the message, drops stale crops, and replies once it recovers', async () => {
  const result = await unavailable();
  const passed = {
    ...result,
    conclusion: { kind: 'no-regression' as const, text: '' },
  };
  const calls = discord([message(earlier), message(later)]);
  const delivered = await deliverDiscord({
    token: 'bot',
    channel,
    previous: { channel, message: earlier, failing: true },
    result: passed,
    failing: false,
    links,
    crops: null,
  });

  expect(calls.map((call) => call.method)).toEqual(['PATCH', 'POST']);
  expect(calls[0]?.url).toContain(`/messages/${earlier}`);
  expect(calls[0]?.payload).toMatchObject({
    attachments: [],
    allowed_mentions: { parse: [] },
  });
  expect(calls[1]?.payload).toMatchObject({
    message_reference: { message_id: earlier },
    allowed_mentions: { parse: [], replied_user: false },
  });
  expect(delivered.state).toEqual({
    channel,
    message: earlier,
    failing: false,
  });
  expect(delivered.notes.map((note) => note.text)).toContain(
    'Discord: replied that it recovered',
  );
});

test('a deleted message is posted again while failing', async () => {
  const again = discord([refused(404, 10008), message(later)]);
  const reposted = await deliverDiscord({
    token: 'bot',
    channel,
    previous: { channel, message: earlier, failing: true },
    result: null,
    failing: true,
    links,
    crops: null,
  });

  expect(again.map((call) => call.method)).toEqual(['PATCH', 'POST']);
  expect(reposted.state?.message).toBe(later);
  expect(reposted.notes[0]?.text).toBe('Discord: posted a message');
});

test('a deleted message is forgotten, not posted again, once the result stops failing', async () => {
  const calls = discord([refused(404, 10008)]);
  const delivered = await deliverDiscord({
    token: 'bot',
    channel,
    previous: { channel, message: earlier, failing: true },
    result: null,
    failing: false,
    links,
    crops: null,
  });

  expect(calls.map((call) => call.method)).toEqual(['PATCH']);
  expect(delivered.state).toBeNull();
});

test('without Attach Files the message goes out without the image and says why', async () => {
  const calls = discord([refused(403, 50013), message(earlier)]);
  const delivered = await deliverDiscord({
    token: 'bot',
    channel,
    previous: null,
    result: null,
    failing: true,
    links,
    crops,
  });

  expect(calls[1]?.file).toBeNull();
  expect(calls[1]?.payload).toMatchObject({ attachments: [] });
  expect(delivered.state?.message).toBe(earlier);
  expect(delivered.notes).toContainEqual({
    text: 'Discord: no image, because the bot lacks Attach Files in the channel',
    level: 'warning',
  });
});

test('a rate limit is retried once after the documented wait, then reported', async () => {
  const limited = () =>
    Response.json(
      {
        message: 'You are being rate limited.',
        retry_after: 0.01,
        global: false,
      },
      { status: 429 },
    );
  const calls = discord([limited, message(earlier)]);
  const delivered = await deliverDiscord({
    token: 'bot',
    channel,
    previous: null,
    result: null,
    failing: true,
    links,
    crops: null,
  });

  expect(calls).toHaveLength(2);
  expect(delivered.state?.message).toBe(earlier);

  discord([limited, limited]);
  const refusedTwice = await deliverDiscord({
    token: 'bot',
    channel,
    previous: null,
    result: null,
    failing: true,
    links,
    crops: null,
  });

  expect(refusedTwice.state).toBeNull();
  expect(refusedTwice.notes).toEqual([
    {
      text: 'The Discord message failed. The Discord message was rate limited.',
      level: 'warning',
    },
  ]);
});
