import { afterEach, expect, test } from 'vitest';
import {
  checkConclusion,
  checkConclusions,
  commentMarker,
  DeliveryError,
  findComment,
  writeComment,
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

  await writeComment(target, await findComment(target, marker), marker, 'new');

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

  await writeComment(target, await findComment(target, marker), marker, 'new');

  expect(calls.at(-1)).toMatchObject({
    method: 'POST',
    path: '/repos/o/r/issues/7/comments',
    body: { body: `${marker}\nnew` },
  });
});

test('fork and Dependabot runs say why nothing was posted, and runs without the App add no note', () => {
  const note = (options: { configured: boolean; untrustedSource: boolean }) =>
    deliveryNote({ note: '', tokenOutcome: '', ...options });

  expect(note({ configured: false, untrustedSource: true })).toContain(
    'forks and Dependabot receive no secrets',
  );
  expect(note({ configured: false, untrustedSource: false })).toBeNull();
});

test('captured text cannot mention people or reference issues from a comment', () => {
  expect(inlineText('ping @maintainer about o/r#12')).not.toMatch(
    /@maintainer|r\\?#12/,
  );
});

test('a rejected request reports its status without echoing the response body', async () => {
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => Response.json({ message: 'secret-marker' }, { status: 422 }),
  });

  const failure = await findComment(
    {
      api: String(server.url).replace(/\/$/, ''),
      repository: 'o/r',
      token: 'test-token',
      headSha: 'a'.repeat(40),
      pullRequest: 7,
      detailsUrl: 'https://github.test/report',
      botLogin: 'observed-sofware[bot]',
    },
    commentMarker('observed-bundle'),
  ).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(DeliveryError);
  expect(failure).toMatchObject({
    message: 'GET /repos/o/r/issues/7/comments answered HTTP 422',
  });
});
