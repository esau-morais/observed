import { Effect } from 'effect';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
  commentMarker,
  DeliveryError,
  findComment,
  failing,
  writeComment,
  type Target,
} from '../scripts/github-delivery';
import {
  deliveryLine,
  deliveryUnfinished,
  inlineText,
  jobDelivery,
  refusal,
} from '../scripts/github-action';
import { compareCaptures, inspectSide } from '../src/comparison';
import { json } from '../src/encoding';

let server: ReturnType<typeof Bun.serve> | null = null;

afterEach(async () => {
  await server?.stop(true);
  server = null;
});

test('Slack treats a missing or unreadable result as failing', () => {
  expect(failing(null)).toBe(true);
  expect(failing('unavailable')).toBe(true);
  expect(failing('preview')).toBe(false);
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
    pullRequest: 7,
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
      pullRequest: 7,
      botLogin: 'observed-sofware[bot]',
    },
    commentMarker('observed-bundle'),
  ).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(DeliveryError);
  expect(failure).toMatchObject({
    message: 'GET /repos/o/r/issues/7/comments answered HTTP 422',
  });
});

test("a refused write names the permission from GitHub's header", async () => {
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () =>
      Response.json(
        { message: 'Resource not accessible by integration' },
        {
          status: 403,
          headers: {
            'x-accepted-github-permissions':
              'issues=write; pull_requests=write',
          },
        },
      ),
  });

  const failure = await findComment(
    {
      api: String(server.url).replace(/\/$/, ''),
      repository: 'o/r',
      token: 'test-token',
      pullRequest: 7,
      botLogin: 'github-actions[bot]',
    },
    commentMarker('observed-bundle'),
  ).catch((error: unknown) => error);

  expect(refusal(failure, 'same-repository')).toEqual({
    kind: 'not-posted',
    reason:
      "Add issues: write or pull-requests: write to the workflow's permissions.",
    level: 'warning',
  });
  expect(refusal(failure, 'dependabot')).toMatchObject({ level: 'notice' });
});

test('the job summary names a delivery that never reported back', () => {
  expect(jobDelivery('')).toBe(deliveryUnfinished);
  expect(
    deliveryLine(
      [
        { name: 'check title', outcome: { kind: 'posted', url: null } },
        {
          name: 'comment',
          outcome: { kind: 'not-posted', reason: 'Why.', level: 'warning' },
        },
      ],
      [],
    ),
  ).toBe('Posted: check title. Not posted: comment. Why.');
});

const evaluatedAt = '2026-09-23T12:00:00.000Z';

async function resultFile(
  directory: string,
  conclusion: { kind: 'preview' | 'regression'; text: string },
) {
  const missing = await Effect.runPromise(
    inspectSide({ directory: null, prefix: 'candidate', evaluatedAt }),
  );
  const result = compareCaptures({
    base: missing,
    candidate: missing,
    evaluatedAt,
    visual: { kind: 'unavailable', reason: 'No captures' },
    mode: conclusion.kind === 'preview' ? 'preview' : 'comparison',
  });
  const file = path.join(directory, 'result.json');

  await writeFile(
    file,
    json({ directory: '/bundle', result: { ...result, conclusion } }),
  );

  return file;
}

type Call = { method: string; path: string; body: unknown };

// Runs the action's deliver step as action.yml does, against a local GitHub
// that refuses check run writes when asked to.
async function deliver(options: {
  conclusion: { kind: 'preview' | 'regression'; text: string };
  headRepository?: string;
  actor?: string;
  refuse?: { status: number; permissions: string };
}) {
  const calls: Call[] = [];
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      calls.push({
        method: request.method,
        path: url.pathname,
        body: request.method === 'GET' ? null : await request.json(),
      });

      if (
        options.refuse !== undefined &&
        url.pathname.includes('/check-runs/')
      ) {
        return Response.json(
          { message: 'Resource not accessible by integration' },
          {
            status: options.refuse.status,
            headers: {
              'x-accepted-github-permissions': options.refuse.permissions,
            },
          },
        );
      }

      return request.method === 'GET'
        ? Response.json([])
        : Response.json({ id: 9, html_url: 'https://github.test/9' });
    },
  });

  const directory = await mkdtemp(path.join(tmpdir(), 'observed-deliver-'));

  try {
    const outputs = path.join(directory, 'outputs');
    const file = await resultFile(directory, options.conclusion);

    await writeFile(outputs, '');

    const child = Bun.spawn(
      [
        process.execPath,
        'scripts/github-action.ts',
        'deliver',
        file,
        options.conclusion.kind === 'preview' ? '0' : '2',
        'observed-bundle',
        '',
      ],
      {
        cwd: path.resolve(import.meta.dirname, '..'),
        env: {
          PATH: process.env.PATH ?? '',
          GITHUB_API_URL: String(server.url).replace(/\/$/, ''),
          GITHUB_REPOSITORY: 'o/r',
          GITHUB_ACTOR: options.actor ?? 'someone',
          GITHUB_OUTPUT: outputs,
          OBSERVED_GITHUB_TOKEN: 'test-token',
          OBSERVED_CHECK_RUN_ID: '42',
          OBSERVED_PULL_REQUEST: '7',
          OBSERVED_HEAD_REPOSITORY: options.headRepository ?? 'o/r',
          OBSERVED_HEAD_SHA: 'a'.repeat(40),
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [code, stdout] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
    ]);
    const note = /^note=(.*)$/m.exec(await readFile(outputs, 'utf8'))?.[1];

    return { code, stdout, note, calls };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("a preview titles the job's own check and leaves its conclusion to the job", async () => {
  const run = await deliver({
    conclusion: { kind: 'preview', text: 'Captured the page.' },
  });
  const title = run.calls.find(({ method }) => method === 'PATCH');

  expect(run.code).toBe(0);
  expect(title?.path).toBe('/repos/o/r/check-runs/42');
  expect(JSON.stringify(title?.body)).toMatch(/"title":"Preview: /);
  expect(title?.body).not.toHaveProperty('conclusion');
  expect(run.note).toBe(
    'Posted: [check title](https://github.test/9) and [comment](https://github.test/9).',
  );
});

test('a missing permission is named on the run and never fails the step', async () => {
  const run = await deliver({
    conclusion: { kind: 'regression', text: 'Regressed.' },
    refuse: { status: 403, permissions: 'checks=write' },
  });

  expect(run.code).toBe(0);
  expect(run.note).toBe(
    "Posted: [comment](https://github.test/9). Not posted: check title. Add checks: write to the workflow's permissions.",
  );
  expect(run.stdout).toContain(
    "::warning title=Observed::Not posted: check title. Add checks: write to the workflow's permissions.",
  );
});

test('a fork gets a read-only notice and no write is attempted', async () => {
  const run = await deliver({
    conclusion: { kind: 'regression', text: 'Regressed.' },
    headRepository: 'someone/r',
  });

  expect(run.calls).toEqual([]);
  expect(run.note).toContain('read-only token');
  expect(run.stdout).toMatch(/^::notice title=Observed::.*read-only token/m);
});

test('a Dependabot run without write permissions gets a read-only notice', async () => {
  const run = await deliver({
    conclusion: { kind: 'regression', text: 'Regressed.' },
    actor: 'dependabot[bot]',
    refuse: { status: 403, permissions: 'checks=write' },
  });

  expect(run.stdout).toMatch(/^::notice title=Observed::.*read-only token/m);
  expect(run.stdout).not.toContain('::warning');
});
