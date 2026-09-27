import { Option, Schema } from 'effect';
import { conclusionExitCodes, type Comparison } from '../src/comparison-model';

type Kind = Comparison['conclusion']['kind'];

// Missing or unreadable evidence counts as failing, like an unavailable result.
export function failing(kind: Kind | null): boolean {
  return kind === null || conclusionExitCodes[kind] !== 0;
}

export function checkName(artifact: string): string {
  return artifact === 'observed-bundle' ? 'Observed' : `Observed (${artifact})`;
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
  method: 'GET' | 'POST' | 'PATCH',
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
