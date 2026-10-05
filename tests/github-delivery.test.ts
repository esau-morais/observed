import { Effect } from 'effect';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import {
  commentMarker,
  DeliveryError,
  findComment,
  failing,
  uploadImage,
  writeComment,
  type Target,
} from '../scripts/github-delivery';
import {
  deliveredScreenshots,
  imageCutoff,
  imageRef,
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
  vi.unstubAllGlobals();
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

const target = {
  api: 'https://api.github.com',
  repository: 'o/r',
  token: 'ghs_workflow',
  pullRequest: 7,
  botLogin: 'github-actions[bot]',
};
const artifactLink = 'https://github.com/o/r/actions/runs/1/artifacts/3';

async function cropsFile(): Promise<{ crops: string; directory: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), 'observed-image-'));
  const crops = path.join(directory, 'observed-bundle-screenshots.png');

  await writeFile(crops, 'png');

  return { crops, directory };
}

const screenshotsFor = (
  crops: string,
  options: {
    trusted?: boolean;
    commenting?: boolean;
    fork?: boolean;
    userToken?: string;
  } = {},
) =>
  deliveredScreenshots({
    trusted: options.trusted ?? true,
    commenting: options.commenting ?? true,
    fork: options.fork ?? false,
    path: crops,
    link: artifactLink,
    target,
    server: 'https://github.com',
    ref: imageRef(new Date('2026-10-04T12:00:00Z'), {
      run: '9',
      attempt: '1',
      artifact: 'observed-bundle',
    }),
    cutoff: imageCutoff(new Date('2026-10-04T12:00:00Z'), '7'),
    userToken: options.userToken ?? '',
    repositoryId: '42',
  });

// The comment loads the crops from a commit that the workflow token stores
// under refs/observed/crops/, by SHA. Refs from before the artifact
// retention are deleted, so stored images do not grow without bound.
test('the workflow token stores the crops in a dated ref outside refs/heads, the comment loads them by commit, and expired refs are pruned', async () => {
  const { crops, directory } = await cropsFile();
  const sha = (letter: string) => letter.repeat(40);
  const calls: string[] = [];
  const posted: unknown[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      const route = `${init.method ?? 'GET'} ${url.replace('https://api.github.com/repos/o/r/git', '')}`;

      calls.push(route);

      if (init.method === 'POST') {
        posted.push(JSON.parse(typeof init.body === 'string' ? init.body : ''));
      }

      const answers: Record<string, Response> = {
        'POST /blobs': Response.json({ sha: sha('a') }, { status: 201 }),
        'POST /trees': Response.json({ sha: sha('b') }, { status: 201 }),
        'POST /commits': Response.json({ sha: sha('c') }, { status: 201 }),
        'POST /refs': Response.json({}, { status: 201 }),
        'GET /matching-refs/observed/crops/': Response.json([
          { ref: 'refs/observed/crops/2026-09-20/1-1-observed-bundle' },
          { ref: 'refs/observed/crops/2026-09-27/2-1-observed-bundle' },
          { ref: 'refs/observed/crops/2026-10-04/9-1-observed-bundle' },
        ]),
      };

      return Promise.resolve(
        answers[route] ?? new Response(null, { status: 204 }),
      );
    }),
  );

  expect(await screenshotsFor(crops)).toEqual({
    image: `https://github.com/o/r/raw/${sha('c')}/observed-bundle-screenshots.png`,
    link: artifactLink,
    note: null,
  });
  expect(posted).toContainEqual({
    ref: 'refs/observed/crops/2026-10-04/9-1-observed-bundle',
    sha: sha('c'),
  });
  expect(calls.filter((call) => call.startsWith('DELETE'))).toEqual([
    'DELETE /refs/observed/crops/2026-09-20/1-1-observed-bundle',
  ]);

  // upload-artifact reads 0 as the repository default, which can be longer.
  expect(imageCutoff(new Date('2026-10-04T12:00:00Z'), '0')).toBeNull();

  const refFor = (artifact: string) =>
    imageRef(new Date('2026-10-04T12:00:00Z'), {
      run: '9',
      attempt: '1',
      artifact,
    });

  expect(refFor('a.b')).not.toBe(refFor('a-b'));

  await rm(directory, { recursive: true, force: true });
});

// A read-only token gets 403 (run 37165079462 on
// esau-morais/observed-trial-express), and the user-attachments endpoint
// answers 404 to GITHUB_TOKEN and App installation tokens (cli/cli#14309).
// A refusal must keep the link and say why, and nothing is stored unless a
// trusted result is commented on, or for a fork.
test('a refused store keeps the crops link and says why, falls back to a user token, and stores nothing for untrusted, uncommented or fork runs', async () => {
  const { crops, directory } = await cropsFile();
  const fetch = vi.fn((url: string | URL) =>
    Promise.resolve(
      String(url).startsWith('https://uploads.github.com/')
        ? Response.json({ message: 'Not Found' }, { status: 404 })
        : Response.json(
            { message: 'Resource not accessible by integration' },
            { status: 403 },
          ),
    ),
  );

  vi.stubGlobal('fetch', fetch);

  expect(await screenshotsFor(crops, { trusted: false })).toBeNull();
  expect(await screenshotsFor(crops, { commenting: false })).toEqual({
    image: null,
    link: artifactLink,
    note: null,
  });
  expect((await screenshotsFor(crops, { fork: true }))?.note).toContain(
    'forks',
  );
  expect(fetch).not.toHaveBeenCalled();

  expect(await screenshotsFor(crops)).toEqual({
    image: null,
    link: artifactLink,
    note: "The comment links the screenshot crops because the workflow token cannot write to this repository. Add contents: write to the workflow's permissions to show them.",
    expected: true,
  });
  expect(fetch).toHaveBeenCalledTimes(1);

  expect(await screenshotsFor(crops, { userToken: 'gho_user' })).toEqual({
    image: null,
    link: artifactLink,
    note: 'The comment links the screenshot crops. GitHub refused the image upload with HTTP 404. It accepts only a user token with write access to this repository.',
    expected: false,
  });
  expect(fetch).toHaveBeenCalledTimes(3);

  await expect(
    uploadImage({
      server: 'https://github.example.com',
      token: 't',
      repositoryId: '42',
      name: 'a.png',
      bytes: new Uint8Array([1]),
      contentType: 'image/png',
    }),
  ).rejects.toBeInstanceOf(DeliveryError);
  expect(fetch).toHaveBeenCalledTimes(3);

  await rm(directory, { recursive: true, force: true });
});
