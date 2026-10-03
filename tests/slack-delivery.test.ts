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

test('a failing Slack message leads with the values and the source location, without captured text', async () => {
  const result = await unavailable();
  const [journey] = result.journeys;
  const check = {
    scope: 'One Reading click',
    expectation: 'No uncaught page errors.',
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
              id: 'errors',
              name: 'No browser errors',
              verdict: 'regression',
              detail: 'TypeError: Captured page text',
              measure: {
                label: 'Browser errors',
                base: '0',
                candidate: '1',
                limit: 'none allowed',
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
          findings: [
            {
              id: 'error-1',
              evidence: 'browser-errors',
              checks: ['errors'],
              subject: 'TypeError',
              comparison: 'new',
              location: {
                kind: 'anchored',
                anchors: [
                  {
                    path: 'src/App.jsx',
                    line: 10,
                    side: 'candidate',
                    basis: 'stack-frame',
                    evidence: 'Captured frame text',
                    artifacts: [],
                    diff: 'added',
                  },
                ],
              },
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
      text: ':red_circle: *Regression: Browser errors 0 → 1, none allowed* · thrown at `src/App.jsx:10` · <https://github.com/o/r/pull/7|o/r#7>',
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

test('the Slack message counts the change scope and names files not observed, without their reasons', async () => {
  const result = await unavailable();
  const sha = 'a'.repeat(64);
  const files = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => ({
    path: `src/${name}.ts`,
    change: 'modified' as const,
    captured: true as const,
    relation: 'not-observed' as const,
    basis: 'none' as const,
    reason: "Coverage could not map this file's lines: Captured coverage text",
    journeys: [],
    checks: [],
  }));
  const text = JSON.stringify(
    slackMessage(
      {
        ...result,
        changeScope: {
          kind: 'recorded',
          sources: { base: sha, candidate: sha },
          files,
          outside: { kind: 'listed' },
          coverage: [],
          recipe: { kind: 'unavailable', reason: 'Not compared in this test' },
        },
      },
      links,
    ),
  );

  expect(text).toContain('6 captured files changed: 6 not observed.');
  expect(text).toContain('Not observed: `src/a.ts`');
  expect(text).toContain('`src/e.ts` and 1 more');
  expect(text).not.toContain('src/f.ts');
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

// The three steps in https://docs.slack.dev/messaging/working-with-files.md:
// get an upload URL, POST the bytes as application/octet-stream, then share
// the file in the channel and thread.
test('the image upload follows the documented steps and sends its bytes as octet-stream', async () => {
  const answers: Record<string, () => Response> = {
    'https://slack.com/api/files.getUploadURLExternal': () =>
      Response.json({
        ok: true,
        upload_url: 'https://files.slack.com/upload/v1/abc',
        file_id: 'F012AB3CDE4',
      }),
    'https://files.slack.com/upload/v1/abc': () => new Response('OK - 3'),
    'https://slack.com/api/files.completeUploadExternal': () =>
      Response.json({ ok: true }),
  };
  const calls: {
    url: string;
    headers: Headers;
    body: string | Uint8Array;
  }[] = [];

  vi.stubGlobal('fetch', async (target: string | URL, init: RequestInit) => {
    const url = String(target);
    let body: string | Uint8Array = '';

    if (init.body instanceof Blob) {
      body = new Uint8Array(await init.body.arrayBuffer());
    } else if (typeof init.body === 'string') {
      body = init.body;
    }

    calls.push({ url, headers: new Headers(init.headers), body });

    return (answers[url] ?? (() => new Response(null, { status: 404 })))();
  });

  await expect(
    uploadSlackImage('xoxb-test', {
      channel: 'C1',
      threadTs: '1.1',
      filename: 'observed-changed-pixels.png',
      title: 'Changed pixels',
      altText: 'Changed pixels',
      bytes: new Uint8Array([1, 2, 3]),
    }),
  ).resolves.toBe('uploaded');

  const [start, upload, complete] = calls;

  expect(start?.body).toContain('length=3');
  expect(upload?.url).toBe('https://files.slack.com/upload/v1/abc');
  expect(upload?.headers.get('content-type')).toBe('application/octet-stream');
  expect(upload?.body).toEqual(new Uint8Array([1, 2, 3]));
  expect(complete?.body).toContain('channel_id=C1');
  expect(complete?.body).toContain('thread_ts=1.1');
});
