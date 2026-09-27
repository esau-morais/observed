import { Effect } from 'effect';
import { afterEach, expect, test, vi } from 'vitest';
import {
  diffCrop,
  readSlackState,
  slackAction,
  slackMessage,
  uploadSlackImage,
  writeSlackState,
} from '../scripts/slack-delivery';
import { decodePng, encodeRgbPng } from '../src/png';
import { slackSkipReason } from '../scripts/github-action';
import { compareCaptures, inspectSide } from '../src/comparison';

const evaluatedAt = '2026-09-26T12:00:00.000Z';

afterEach(() => {
  vi.unstubAllGlobals();
});
const links = {
  name: 'Observed',
  pullRequest: 'https://github.com/o/r/pull/7',
  pullRequestLabel: 'o/r#7',
  report: 'https://github.com/o/r/actions/runs/1/artifacts/2',
  run: 'https://github.com/o/r/actions/runs/1',
};

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

test('Slack notifies when a pull request starts failing or recovers, and edits quietly otherwise', () => {
  const failing = { channel: 'C1', ts: '1.1', failing: true };
  const passing = { ...failing, failing: false };
  const fails = { failing: true, passed: false };
  const passes = { failing: false, passed: true };
  const neutral = { failing: false, passed: false };

  expect(slackAction(null, 'C1', fails)).toBe('post');
  expect(slackAction(null, 'C1', passes)).toBe('none');
  expect(slackAction(failing, 'C1', fails)).toBe('update');
  expect(slackAction(failing, 'C1', passes)).toBe('recover');
  expect(slackAction(failing, 'C1', neutral)).toBe('update');
  expect(slackAction(passing, 'C1', passes)).toBe('update');
  expect(slackAction(passing, 'C1', fails)).toBe('post');
  expect(slackAction(failing, 'C2', fails)).toBe('post');
});

test('an unavailable or unreadable result never gets a passing icon in Slack', async () => {
  for (const result of [await unavailable(), null]) {
    const message = JSON.stringify(slackMessage(result, links));

    expect(message).toContain(':warning:');
    expect(message).not.toContain(':white_check_mark:');
  }
});

test('captured names cannot mention anyone in Slack, and captured values stay out of the message', async () => {
  const result = await unavailable();
  const [journey] = result.journeys;
  const verdict = {
    id: 'total',
    name: 'Order total <!channel> <@U123>',
    scope: 'One checkout',
    expectation: 'Exactly one .total element with text "$10".',
  };
  const message = JSON.stringify(
    slackMessage(
      {
        ...result,
        title: 'Checkout <!channel> <@U123>',
        journeys: [
          {
            ...journey,
            checks: [
              { ...verdict, verdict: 'passed', detail: 'Captured page text' },
              {
                ...verdict,
                id: 'items',
                verdict: 'unknown',
                detail: 'Captured item text',
              },
            ],
          },
        ],
        summary: { passed: 1, total: 2 },
        conclusion: { kind: 'unavailable', text: 'Captured page text' },
      },
      links,
    ),
  );

  expect(message).not.toMatch(/<!channel>|<@U123>/);
  expect(message).toContain(
    'Unavailable: Order total &lt;!channel&gt; &lt;@U123&gt;',
  );
  expect(message).toContain('1 of 2 checks unknown');
  expect(message).not.toContain('Captured page text');
  expect(message).not.toContain('Captured item text');
});

test('the Slack message identity stored in a comment round-trips and ignores malformed markers', () => {
  const state = { channel: 'C0123', ts: '1712345678.123456', failing: true };

  expect(readSlackState(`x\n${writeSlackState(state)}\ny`)).toEqual(state);
  expect(
    readSlackState('<!-- observed-slack:C1/<script>/failing -->'),
  ).toBeNull();
  expect(readSlackState(null)).toBeNull();
});

test('Slack is skipped with a reason instead of posting duplicates or to a guessed channel', () => {
  const reason = (options: Partial<Parameters<typeof slackSkipReason>[0]>) =>
    slackSkipReason({
      token: 'token',
      channel: 'C0123',
      pullRequest: 7,
      lookupFailed: false,
      ...options,
    });

  expect(reason({})).toBeNull();
  expect(reason({ token: '', channel: '' })).toBeNull();
  expect(reason({ channel: '' })).toContain('set both');
  expect(reason({ channel: '#observed-test' })).toContain('channel ID');
  expect(reason({ pullRequest: null })).toContain('only for pull requests');
  expect(reason({ lookupFailed: true })).toContain('could not be looked up');
});

test('a failing Slack message leads with the measured values and links out, without captured text', async () => {
  const result = await unavailable();
  const [journey] = result.journeys;
  const check = {
    scope: 'Open the page',
    expectation: 'Median LCP at most 250 ms.',
  };
  const message = slackMessage(
    {
      ...result,
      journeys: [
        {
          ...journey,
          checks: [
            {
              ...check,
              id: 'lcp',
              name: 'Largest contentful paint stays fast',
              verdict: 'regression',
              detail: 'Captured page text',
              measure: {
                label: 'Median LCP',
                base: '52 ms',
                candidate: '452 ms',
                limit: 'at most 250 ms',
              },
            },
            {
              ...check,
              id: 'books',
              name: 'One books request',
              verdict: 'passed',
              detail: 'Captured item text',
            },
          ],
        },
      ],
      summary: { passed: 1, total: 2 },
      conclusion: { kind: 'regression', text: 'Captured page text' },
    },
    links,
  );
  const text = JSON.stringify(message);

  expect(message.blocks[0]).toMatchObject({
    text: {
      text: ':red_circle: *Regression: Median LCP 52 ms → 452 ms, at most 250 ms* · <https://github.com/o/r/pull/7|o/r#7>',
    },
  });
  expect(text).toContain('1 of 2 checks failed');
  expect(message.blocks[2]).toMatchObject({
    type: 'actions',
    elements: [
      { text: { text: 'Open report' }, url: links.report },
      { text: { text: 'View on PR' }, url: links.pullRequest },
    ],
  });
  expect(text).not.toContain('Captured');
});

test('the Slack image is one changed region with a margin, clamped to the screenshot', () => {
  const width = 100;
  const rgb = new Uint8Array(width * width * 3).map((_, index) => index % 251);
  const crop = diffCrop(encodeRgbPng(width, width, rgb), {
    x: 90,
    y: 5,
    width: 10,
    height: 10,
    changedPixels: 100,
  });
  const decoded = crop === null ? null : decodePng(crop);

  if (decoded?.kind !== 'decoded') {
    throw new Error('The crop is not a readable PNG');
  }

  expect([decoded.image.width, decoded.image.height]).toEqual([26, 31]);
  expect(Array.from(decoded.image.rgba.subarray(0, 3))).toEqual(
    Array.from(rgb.subarray(74 * 3, 74 * 3 + 3)),
  );
});

// Slack answers a token without the scope with ok: false and missing_scope,
// per https://docs.slack.dev/reference/methods/files.getUploadURLExternal
test('without files:write the image is skipped and nothing else is sent', async () => {
  const fetch = vi.fn(() =>
    Promise.resolve(Response.json({ ok: false, error: 'missing_scope' })),
  );

  vi.stubGlobal('fetch', fetch);

  await expect(
    uploadSlackImage('xoxb-test', {
      channel: 'C1',
      threadTs: '1.1',
      filename: 'observed-changed-pixels.png',
      title: 'Changed pixels',
      altText: 'Changed pixels',
      bytes: new Uint8Array([1]),
    }),
  ).resolves.toBe('missing-scope');
  expect(fetch).toHaveBeenCalledTimes(1);
});
