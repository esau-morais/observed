import { Option, Schema } from 'effect';
import { conclusionExitCodes, type Comparison } from '../src/comparison-model';

type Kind = Comparison['conclusion']['kind'];

// Missing or unreadable evidence counts as failing, like an unavailable result.
export function failing(kind: Kind | null): boolean {
  return kind === null || conclusionExitCodes[kind] !== 0;
}

// The action's default artifact-name input.
export const defaultArtifact = 'observed-bundle';

export function checkName(artifact: string): string {
  return artifact === defaultArtifact ? 'Observed' : `Observed (${artifact})`;
}

export function commentMarker(artifact: string): string {
  return `<!-- observed:${encodeURIComponent(artifact)} -->`;
}

const maxBody = 65_000;

function limit(markdown: string): string {
  return markdown.length <= maxBody
    ? markdown
    : `${markdown.slice(0, maxBody)}\n\nThe summary was cut to fit GitHub's limit. Open the report for the rest.`;
}

export class DeliveryError extends Schema.TaggedError<DeliveryError>()(
  'DeliveryError',
  {
    message: Schema.String,
    status: Schema.NullOr(Schema.Number),
    // GitHub's X-Accepted-GitHub-Permissions header on a refused write.
    permissions: Schema.NullOr(Schema.String),
  },
) {}

// "issues=write; pull_requests=write" becomes the permissions: lines a
// workflow would grant, "issues: write or pull-requests: write".
export function permissionLines(header: string): string | null {
  const lines = header
    .split(';')
    .map((entry) => entry.trim().split('='))
    .flatMap(([scope, level]) =>
      scope !== undefined &&
      level !== undefined &&
      /^[a-z_]+$/.test(scope) &&
      /^(read|write)$/.test(level)
        ? [`${scope.replaceAll('_', '-')}: ${level}`]
        : [],
    );

  return lines.length === 0 ? null : lines.join(' or ');
}

export type Target = {
  api: string;
  repository: string;
  token: string;
  pullRequest: number | null;
  botLogin: string;
};

const created = Schema.Struct({
  id: Schema.Number,
  html_url: Schema.NullOr(Schema.String),
});

const comments = Schema.Array(
  Schema.Struct({
    id: Schema.Number,
    body: Schema.optionalKey(Schema.String),
    user: Schema.NullOr(Schema.Struct({ login: Schema.String })),
  }),
);

async function request<A>(
  target: Target,
  schema: Schema.Codec<A>,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<A> {
  const route = `${method} ${path.split('?')[0] ?? path}`;
  let response: Response;

  try {
    response = await fetch(`${target.api}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${target.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new DeliveryError({
      message: `${route} did not answer`,
      status: null,
      permissions: null,
    });
  }

  if (!response.ok) {
    throw new DeliveryError({
      message: `${route} answered HTTP ${String(response.status)}`,
      status: response.status,
      permissions: response.headers.get('x-accepted-github-permissions'),
    });
  }

  const decoded = Schema.decodeUnknownOption(schema)(
    await response.json().catch(() => null),
  );

  if (Option.isNone(decoded)) {
    throw new DeliveryError({
      message: `${route} answered unexpectedly`,
      status: response.status,
      permissions: null,
    });
  }

  return decoded.value;
}

// Titles the job's own check run, so the verdict stays with the workflow run
// that produced it. The job's conclusion stays the runner's to set.
export async function titleJobCheck(
  target: Target,
  checkRunId: string,
  check: { title: string; markdown: string },
): Promise<string | null> {
  const run = await request(
    target,
    created,
    'PATCH',
    `/repos/${target.repository}/check-runs/${encodeURIComponent(checkRunId)}`,
    {
      output: {
        title: check.title.slice(0, 255),
        summary: limit(check.markdown),
      },
    },
  );

  return run.html_url;
}

export type OwnComment = { id: number; body: string };

export async function findComment(
  target: Target,
  marker: string,
): Promise<OwnComment | null> {
  if (target.pullRequest === null) {
    return null;
  }

  for (let page = 1; page <= 20; page++) {
    const listed = await request(
      target,
      comments,
      'GET',
      `/repos/${target.repository}/issues/${String(target.pullRequest)}/comments?per_page=100&page=${String(page)}`,
    );
    const own = listed.find(
      (comment) =>
        comment.user?.login === target.botLogin &&
        comment.body?.startsWith(marker) === true,
    );

    if (own !== undefined) {
      return { id: own.id, body: own.body ?? '' };
    }

    if (listed.length < 100) {
      break;
    }
  }

  return null;
}

export async function writeComment(
  target: Target,
  existing: OwnComment | null,
  marker: string,
  markdown: string,
): Promise<string | null> {
  if (target.pullRequest === null) {
    return null;
  }

  const body = limit(`${marker}\n${markdown}`);
  const written =
    existing === null
      ? await request(
          target,
          created,
          'POST',
          `/repos/${target.repository}/issues/${String(target.pullRequest)}/comments`,
          { body },
        )
      : await request(
          target,
          created,
          'PATCH',
          `/repos/${target.repository}/issues/comments/${String(existing.id)}`,
          { body },
        );

  return written.html_url;
}

const uploadedAsset = Schema.Struct({
  url: Schema.String.check(Schema.isPattern(/^https:\/\/[^\s()<>[\]]+$/)),
});

// GitHub documents no API that adds an image to a comment. This is the
// endpoint behind gh's --attach (cli/cli v2.99.0 and later,
// internal/attachments/client.go, checked 2026-10-03). It accepts OAuth,
// personal access and user-to-server tokens with write access, and answers
// 404 to installation tokens and GITHUB_TOKEN (cli/cli#14309).
export async function uploadImage(image: {
  server: string;
  token: string;
  repositoryId: string;
  name: string;
  bytes: Uint8Array;
  contentType: 'image/png' | 'image/gif';
}): Promise<string> {
  const fail = (message: string, status: number | null) =>
    new DeliveryError({ message, status, permissions: null });

  if (image.server !== 'https://github.com') {
    throw fail('Inline images need github.com', null);
  }

  if (!/^\d+$/.test(image.repositoryId)) {
    throw fail('The runner gave no repository ID', null);
  }

  const url = new URL('https://uploads.github.com/user-attachments/assets');

  url.searchParams.set('name', image.name);
  url.searchParams.set('content_type', image.contentType);
  url.searchParams.set('repository_id', image.repositoryId);

  let response: Response;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${image.token}`,
        'Content-Type': 'application/octet-stream',
      },
      body: new Blob([Buffer.from(image.bytes)]),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw fail('The image upload did not answer', null);
  }

  if (response.status === 404) {
    throw fail(
      'GitHub refused the image upload with HTTP 404. It accepts only a user token with write access to this repository',
      404,
    );
  }

  if (!response.ok) {
    throw fail(
      `The image upload answered HTTP ${String(response.status)}`,
      response.status,
    );
  }

  const decoded = Schema.decodeUnknownOption(uploadedAsset)(
    await response.json().catch(() => null),
  );

  if (Option.isNone(decoded)) {
    throw fail('The image upload answered unexpectedly', response.status);
  }

  return decoded.value.url;
}

const shaSchema = Schema.Struct({
  sha: Schema.String.check(Schema.isPattern(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/)),
});

// Each run's crops get their own ref outside refs/heads, so no branch shows
// up, named by day so old ones can be pruned without reading each commit.
export const imageRefPrefix = 'refs/observed/crops/';

function refPath(ref: string): string {
  return ref.slice('refs/'.length).split('/').map(encodeURIComponent).join('/');
}

// A file in any commit of the repository opens at /raw/<sha>/<path>, and
// GitHub leaves github.com image URLs in comments unproxied, so the reader's
// browser loads the commit's file. With the workflow token and contents:
// write this rendered for signed-out visitors on the public
// esau-morais/observed-trial-express#15, and a read-only token got HTTP 403,
// checked 2026-10-04.
export async function commitImage(
  target: Target,
  image: { server: string; ref: string; name: string; bytes: Uint8Array },
): Promise<string> {
  if (image.server !== 'https://github.com') {
    throw new DeliveryError({
      message: 'Inline images need github.com',
      status: null,
      permissions: null,
    });
  }

  const repository = `/repos/${target.repository}/git`;
  const blob = await request(target, shaSchema, 'POST', `${repository}/blobs`, {
    content: Buffer.from(image.bytes).toString('base64'),
    encoding: 'base64',
  });
  const tree = await request(target, shaSchema, 'POST', `${repository}/trees`, {
    tree: [{ path: image.name, mode: '100644', type: 'blob', sha: blob.sha }],
  });
  const commit = await request(
    target,
    shaSchema,
    'POST',
    `${repository}/commits`,
    { message: 'Observed screenshot crops', tree: tree.sha },
  );

  await request(target, Schema.Unknown, 'POST', `${repository}/refs`, {
    ref: image.ref,
    sha: commit.sha,
  });

  // Parentheses would end the Markdown image early.
  const file = encodeURIComponent(image.name).replace(
    /[()'!*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `${image.server}/${target.repository}/raw/${commit.sha}/${file}`;
}

const matchingRefs = Schema.Array(Schema.Struct({ ref: Schema.String }));

// Bounds the API calls one delivery step spends on cleanup.
const prunedPerRun = 50;

// Deletes crop refs from days before the cutoff, a few per run, so stored
// images last as long as the artifacts they stand in for.
export async function pruneImages(
  target: Target,
  cutoff: string,
): Promise<number> {
  const listed = await request(
    target,
    matchingRefs,
    'GET',
    `/repos/${target.repository}/git/matching-refs/${refPath(imageRefPrefix)}`,
  );
  const expired = listed
    .map(({ ref }) => ref)
    .filter((ref) => {
      const day = /^refs\/observed\/crops\/(\d{4}-\d{2}-\d{2})\//.exec(
        ref,
      )?.[1];

      return day !== undefined && day < cutoff;
    })
    .slice(0, prunedPerRun);

  for (const ref of expired) {
    await request(
      target,
      Schema.Unknown,
      'DELETE',
      `/repos/${target.repository}/git/refs/${refPath(ref)}`,
    );
  }

  return expired.length;
}
