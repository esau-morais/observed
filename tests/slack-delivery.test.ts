import { Effect } from 'effect';
import { expect, test } from 'vitest';
import {
  readSlackState,
  slackAction,
  slackMessage,
  writeSlackState,
} from '../scripts/slack-delivery';
import { slackSkipReason } from '../scripts/github-action';
import { compareCaptures, inspectSide } from '../src/comparison';

const evaluatedAt = '2026-09-26T12:00:00.000Z';
const links = {
  name: 'Observed',
  pullRequest: 'https://github.com/o/r/pull/7',
  pullRequestLabel: 'o/r#7',
  report: 'https://github.com/o/r/actions/runs/1/artifacts/2',
  check: null,
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

test('Slack notifies when a pull request starts failing and edits quietly otherwise', () => {
  const failing = { channel: 'C1', ts: '1.1', failing: true };
  const passing = { ...failing, failing: false };

  expect(slackAction(null, 'C1', true)).toBe('post');
  expect(slackAction(null, 'C1', false)).toBe('none');
  expect(slackAction(failing, 'C1', true)).toBe('update');
  expect(slackAction(failing, 'C1', false)).toBe('update');
  expect(slackAction(passing, 'C1', true)).toBe('post');
  expect(slackAction(failing, 'C2', true)).toBe('post');
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
  expect(message).toContain('&lt;!channel&gt;');
  expect(message).toContain('1 of 2 checks passed');
  expect(message).toContain(
    'Unknown · Order total &lt;!channel&gt; &lt;@U123&gt;. Scope: One checkout',
  );
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
