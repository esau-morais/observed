import { afterEach, expect, test } from 'vitest';
import {
  checkConclusion,
  checkConclusions,
  commentMarker,
  upsertComment,
  type Target,
} from '../scripts/github-delivery';
import { deliveryNote, inlineText } from '../scripts/github-action';

let server: ReturnType<typeof Bun.serve> | null = null;

afterEach(async () => {
  await server?.stop(true);
  server = null;
});

test('a GitHub check never reports success for missing, unchecked or unreadable evidence', () => {
  expect(checkConclusion(null)).toBe('failure');
  expect(
    Object.entries(checkConclusions)
      .filter(([, conclusion]) => conclusion === 'success')
      .map(([kind]) => kind),
  ).toEqual(['no-regression']);
  expect(checkConclusions.unavailable).toBe('failure');
});

function fakeGitHub(existing: { id: number; login: string; body: string }[]) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const body: unknown =
        request.method === 'GET' ? null : await request.json();
      calls.push({ method: request.method, path: url.pathname, body });

      if (request.method === 'GET') {
        return Response.json(
          existing.map(({ id, login, body: text }) => ({
            id,
            body: text,
            user: { login },
          })),
        );
      }

      return Response.json({ id: 9, html_url: 'https://github.test/c/9' });
    },
  });

  const target: Target = {
    api: String(server.url).replace(/\/$/, ''),
    repository: 'o/r',
    token: 'test-token',
    headSha: 'a'.repeat(40),
    pullRequest: 7,
    detailsUrl: 'https://github.test/report',
    botLogin: 'observed-sofware[bot]',
  };

  return { calls, target };
}

test('the pull request comment edits only the marked comment the App wrote', async () => {
  const marker = commentMarker('observed-bundle');
  const { calls, target } = fakeGitHub([
    { id: 1, login: 'someone', body: `${marker}\nforged` },
    { id: 2, login: 'observed-sofware[bot]', body: `${marker}\nold` },
  ]);

  await upsertComment(target, marker, 'new');

  expect(calls.map(({ method, path }) => `${method} ${path}`)).toEqual([
    'GET /repos/o/r/issues/7/comments',
    'PATCH /repos/o/r/issues/comments/2',
  ]);
});

test('a marker copied into another user comment leads to a new App comment', async () => {
  const marker = commentMarker('observed-bundle');
  const { calls, target } = fakeGitHub([
    { id: 1, login: 'someone', body: `${marker}\nforged` },
  ]);

  await upsertComment(target, marker, 'new');

  expect(calls.at(-1)).toMatchObject({
    method: 'POST',
    path: '/repos/o/r/issues/7/comments',
    body: { body: `${marker}\nnew` },
  });
});

test('runs without the App key say why nothing was posted, and captured text cannot mention anyone', () => {
  expect(
    deliveryNote({ note: '', keyProvided: false, tokenOutcome: '' }),
  ).toContain('Pull requests from forks and Dependabot never receive it');
  expect(inlineText('ping @maintainer')).not.toMatch(/@maintainer/);
});
