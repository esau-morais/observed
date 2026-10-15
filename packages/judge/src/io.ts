import { Effect, Predicate, Schema } from 'effect';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { getSystemErrorMap } from 'node:util';
import { sha256 } from './hash';

const systemErrors = getSystemErrorMap();

export class EvidenceIoError extends Schema.TaggedError<EvidenceIoError>()('EvidenceIoError', {
  code: Schema.String,
  cause: Schema.Defect(),
}) {}

// A file system error becomes EvidenceIoError; anything else is a defect.
export function nodeIo<A>(
  operation: (signal: AbortSignal) => Promise<A>,
): Effect.Effect<A, EvidenceIoError> {
  return Effect.tryPromise({
    try: operation,
    catch: (cause) => cause,
  }).pipe(
    Effect.catch((cause) => {
      if (
        Predicate.hasProperty(cause, 'code') &&
        Predicate.isString(cause.code) &&
        Predicate.hasProperty(cause, 'errno') &&
        Predicate.isNumber(cause.errno) &&
        systemErrors.get(cause.errno)?.[0] === cause.code
      ) {
        return Effect.fail(new EvidenceIoError({ code: cause.code, cause }));
      }

      return Effect.die(cause);
    }),
  );
}

export type Artifact = {
  readonly id: string;
  readonly path: string;
  readonly description: string;
  readonly sha256?: string;
};

export type ArtifactResult =
  | {
      kind: 'available';
      artifact: Artifact;
      absolutePath: string;
      hash: string;
    }
  | { kind: 'unavailable'; artifact: Artifact; reason: string };

// Hashes one artifact inside `root`, refusing symlinks, paths that leave the
// root and anything but a regular file.
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
      segments.some((segment) => segment === '' || segment === '.' || segment === '..')
    ) {
      return unavailable('Unsafe artifact path: use a bundle-relative path without dot segments');
    }

    let absolutePath = root;

    for (const segment of segments) {
      absolutePath = path.join(absolutePath, segment);

      const stat = yield* nodeIo(() => lstat(absolutePath));

      if (stat.isSymbolicLink()) {
        return unavailable('Symlink artifacts and symlink directories are not allowed');
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
        open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK),
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
      return unavailable(`SHA-256 mismatch: expected ${artifact.sha256}; found ${digest}`);
    }

    return {
      kind: 'available',
      artifact,
      absolutePath: resolved,
      hash: digest,
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

export const readVerifiedArtifact = Effect.fnUntraced(
  function* (root: string, artifact: Artifact) {
    const inspected = yield* inspectArtifact(root, artifact);

    if (inspected.kind === 'unavailable') {
      return inspected;
    }

    const handle = yield* Effect.acquireRelease(
      nodeIo(() =>
        open(
          inspected.absolutePath,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        ),
      ),
      (owned) => nodeIo(() => owned.close()).pipe(Effect.orDie),
    );

    const stat = yield* nodeIo(() => handle.stat());

    if (!stat.isFile()) {
      return {
        kind: 'unavailable',
        reason: 'Artifact is not a regular file',
      } as const;
    }

    const bytes = yield* nodeIo((signal) => handle.readFile({ signal }));

    if (sha256(bytes) !== inspected.hash) {
      return {
        kind: 'unavailable',
        reason: 'Artifact changed while reading',
      } as const;
    }

    return {
      kind: 'available',
      bytes: new Uint8Array(bytes),
      hash: inspected.hash,
    } as const;
  },
  Effect.scoped,
  Effect.catchTag('EvidenceIoError', (error) =>
    Effect.succeed({
      kind: 'unavailable',
      reason: `Artifact could not be read (${error.code})`,
    } as const),
  ),
);
