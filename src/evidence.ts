import { Effect } from 'effect';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { nodeIo } from './node-io';
import type { Artifact, Check, Manifest } from './schema';

export type ArtifactResult =
  | {
      kind: 'available';
      artifact: Artifact;
      absolutePath: string;
      hash: string;
      integrity: 'matched' | 'not supplied';
    }
  | { kind: 'unavailable'; artifact: Artifact; reason: string };

export type CheckResult = {
  check: Check;
  outcome: 'imported passed' | 'imported failed' | 'unknown';
  reasons: string[];
};

export type EvidenceReport = {
  manifest: Manifest;
  artifacts: ArtifactResult[];
  checks: CheckResult[];
};

export const inspectArtifact = Effect.fnUntraced(
  function* (root: string, artifact: Artifact) {
    const unavailable = (reason: string): ArtifactResult => ({
      kind: 'unavailable',
      artifact,
      reason,
    });

    const segments = artifact.path.split('/');

    if (
      path.isAbsolute(artifact.path) ||
      /[\\:\p{Cc}]/u.test(artifact.path) ||
      segments.some(
        (segment) => segment === '' || segment === '.' || segment === '..',
      )
    ) {
      return unavailable(
        'Unsafe artifact path: use a bundle-relative path without dot segments',
      );
    }

    let absolutePath = root;

    for (const segment of segments) {
      absolutePath = path.join(absolutePath, segment);

      const stat = yield* nodeIo(() => lstat(absolutePath));

      if (stat.isSymbolicLink()) {
        return unavailable(
          'Symlink artifacts and symlink directories are not allowed',
        );
      }
    }

    const resolved = yield* nodeIo(() => realpath(absolutePath));
    const relative = path.relative(root, resolved);

    if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return unavailable('Artifact resolves outside the bundle');
    }

    // Effect FileSystem lacks lstat and numeric O_NOFOLLOW/O_NONBLOCK flags.
    const handle = yield* Effect.acquireRelease(
      nodeIo(() =>
        open(
          resolved,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        ),
      ),
      (handle) => nodeIo(() => handle.close()).pipe(Effect.orDie),
    );

    const stat = yield* nodeIo(() => handle.stat());

    if (!stat.isFile()) {
      return unavailable('Artifact is not a regular file');
    }

    const hash = createHash('sha256');

    yield* nodeIo((signal) =>
      pipeline(handle.createReadStream({ autoClose: false }), hash, { signal }),
    );

    const digest = hash.digest('hex');

    if (artifact.sha256 !== undefined && digest !== artifact.sha256) {
      return unavailable(
        `SHA-256 mismatch: expected ${artifact.sha256}; found ${digest}`,
      );
    }

    return {
      kind: 'available',
      artifact,
      absolutePath: resolved,
      hash: digest,
      integrity: artifact.sha256 === undefined ? 'not supplied' : 'matched',
    } satisfies ArtifactResult;
  },
  Effect.scoped,
  (effect, _root, artifact) =>
    effect.pipe(
      Effect.catchTag('EvidenceIoError', (error) =>
        Effect.succeed({
          kind: 'unavailable',
          artifact,
          reason: `Artifact could not be read (${error.code})`,
        } satisfies ArtifactResult),
      ),
    ),
);

function checkOutcome(
  check: Check,
  reasons: readonly string[],
): CheckResult['outcome'] {
  if (reasons.length > 0) {
    return 'unknown';
  }

  switch (check.result.kind) {
    case 'passed':
      return 'imported passed';

    case 'failed':
      return 'imported failed';

    case 'unknown':
      return 'unknown';
  }
}

export const inspectEvidence = Effect.fn('inspectEvidence')(function* (
  manifest: Manifest,
  bundleRoot: string,
) {
  const root = yield* nodeIo(() => realpath(bundleRoot));

  const artifacts = yield* Effect.forEach(
    manifest.artifacts,
    (artifact) => inspectArtifact(root, artifact),
    { concurrency: 4 },
  );

  const byId = new Map(artifacts.map((result) => [result.artifact.id, result]));

  const checks = manifest.checks.map((check): CheckResult => {
    const reasons = [...check.missingPrerequisites];

    if (check.result.kind === 'unknown') {
      reasons.push(check.result.reason);
    }

    if (manifest.capture.execution !== 'complete') {
      reasons.push(`Capture execution is ${manifest.capture.execution}`);
    }

    if (check.artifactIds.length === 0) {
      reasons.push('No evidence supplied for this check');
    }

    const required = new Set([
      manifest.recipe.artifactId,
      ...manifest.capture.artifactIds,
      ...check.artifactIds,
    ]);

    for (const id of required) {
      const result = byId.get(id);

      if (result === undefined || result.kind === 'unavailable') {
        reasons.push(`${id}: ${result?.reason ?? 'Artifact not defined'}`);
      }
    }

    return { check, outcome: checkOutcome(check, reasons), reasons };
  });

  return { manifest, artifacts, checks } satisfies EvidenceReport;
});
