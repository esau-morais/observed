import { Effect } from 'effect';
import { expect, test } from 'vitest';
import {
  readSlackState,
  slackAction,
  slackMessage,
  writeSlackState,
} from '../scripts/slack-delivery';
import { compareCaptures, inspectSide } from '../src/comparison';

const evaluatedAt = '2026-09-26T12:00:00.000Z';
const links = {
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

test('captured text cannot mention, notify or link anyone in Slack', async () => {
  const result = await unavailable();
  const message = JSON.stringify(
    slackMessage(
      {
        ...result,
        conclusion: {
          kind: 'unavailable',
          text: 'Saw <!here> <@U123> <https://evil.test|click>',
        },
      },
      links,
    ),
  );

  expect(message).not.toMatch(/<!here>|<@U123>|<https:\/\/evil/);
  expect(message).toContain('&lt;!here&gt;');
});

test('the Slack message identity stored in a comment round-trips and ignores malformed markers', () => {
  const state = { channel: 'C0123', ts: '1712345678.123456', failing: true };

  expect(readSlackState(`x\n${writeSlackState(state)}\ny`)).toEqual(state);
  expect(
    readSlackState('<!-- observed-slack:C1/<script>/failing -->'),
  ).toBeNull();
  expect(readSlackState(null)).toBeNull();
});
