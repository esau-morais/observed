import { Schema } from 'effect';
import type { Comparison } from '../src/comparison-model';

type Kind = Comparison['conclusion']['kind'];

// Required checks accept success, neutral and skipped alike, so anything short
// of a verified result must be a failure.
export const checkConclusions = {
  regression: 'failure',
  'check-failed': 'failure',
  unavailable: 'failure',
  'no-regression': 'success',
  'not-checked': 'neutral',
  preview: 'neutral',
} satisfies Record<Kind, 'success' | 'failure' | 'neutral'>;

export function checkConclusion(kind: Kind | null) {
  return kind === null ? 'failure' : checkConclusions[kind];
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

export class DeliveryError extends Error {}

export type Target = {
  api: string;
  repository: string;
  token: string;
  headSha: string;
  pullRequest: number | null;
  detailsUrl: string;
  botLogin: string;
};

const created = Schema.Struct({ id: Schema.Number, html_url: Schema.String });

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
  const response = await fetch(`${target.api}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${target.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (!response.ok) {
    throw new DeliveryError(
      `${method} ${path.split('?')[0] ?? path} answered HTTP ${String(response.status)}`,
    );
  }

  return Schema.decodeUnknownSync(schema)(await response.json());
}

export async function postCheckRun(
  target: Target,
  check: {
    name: string;
    title: string;
    markdown: string;
    conclusion: 'success' | 'failure' | 'neutral';
  },
): Promise<string> {
  const run = await request(
    target,
    created,
    'POST',
    `/repos/${target.repository}/check-runs`,
    {
      name: check.name,
      head_sha: target.headSha,
      status: 'completed',
      conclusion: check.conclusion,
      details_url: target.detailsUrl,
      output: {
        title: check.title.slice(0, 255),
        summary: limit(check.markdown),
      },
    },
  );

  return run.html_url;
}

export async function upsertComment(
  target: Target,
  marker: string,
  markdown: string,
): Promise<string | null> {
  if (target.pullRequest === null) {
    return null;
  }

  const body = limit(`${marker}\n${markdown}`);
  const issue = `/repos/${target.repository}/issues/${String(target.pullRequest)}`;

  for (let page = 1; page <= 20; page++) {
    const listed = await request(
      target,
      comments,
      'GET',
      `${issue}/comments?per_page=100&page=${String(page)}`,
    );
    const own = listed.find(
      (comment) =>
        comment.user?.login === target.botLogin &&
        comment.body?.startsWith(marker) === true,
    );

    if (own !== undefined) {
      const edited = await request(
        target,
        created,
        'PATCH',
        `/repos/${target.repository}/issues/comments/${String(own.id)}`,
        { body },
      );

      return edited.html_url;
    }

    if (listed.length < 100) {
      break;
    }
  }

  const posted = await request(target, created, 'POST', `${issue}/comments`, {
    body,
  });

  return posted.html_url;
}
