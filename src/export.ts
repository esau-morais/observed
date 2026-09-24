import { DateTime, Effect, FileSystem, Schema } from 'effect';
import { constants } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import path from 'node:path';
import { digest, parseCapture, text } from './capture/model';
import { json, sha256 } from './capture/recipe';
import { inspectComparison } from './comparison';
import { selectionSchema, type Selection } from './comparison-model';
import { renderComparison } from './comparison-report';
import { inspectArtifact } from './evidence';
import { nodeIo, type EvidenceIoError } from './node-io';
import type { Artifact } from './schema';

export class ExportFailure extends Schema.TaggedError<ExportFailure>()(
  'ExportFailure',
  { message: Schema.String },
) {}

const viewerPath = text.check(
  Schema.makeFilter(
    (value) =>
      value === 'index.html' ||
      (/^assets\/[a-zA-Z0-9_./-]+$/.test(value) &&
        value.split('/').every((part) => !['', '.', '..'].includes(part)) &&
        [
          '.js',
          '.css',
          '.woff',
          '.woff2',
          '.ttf',
          '.png',
          '.svg',
          '.ico',
        ].includes(path.extname(value))),
    { message: 'Expected index.html or a contained viewer asset path' },
  ),
);

export const viewerIntegritySchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  assets: Schema.NonEmptyArray(
    Schema.Struct({ path: viewerPath, sha256: digest }),
  ),
  reportHash: digest,
}).check(
  Schema.makeFilter(
    (value) =>
      value.assets.some((asset) => asset.path === 'index.html') &&
      new Set(value.assets.map((asset) => asset.path)).size ===
        value.assets.length,
    { message: 'Viewer assets need one index.html and unique paths' },
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

const loadCapture = Effect.fnUntraced(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;

  const root = yield* fs.realPath(directory);

  const manifest = yield* readVerifiedArtifact(root, {
    id: 'capture',
    path: 'capture.json',
    description: 'Capture manifest',
  });

  if (manifest.kind === 'unavailable') {
    return yield* new ExportFailure({
      message: `Capture unavailable: ${manifest.reason}`,
    });
  }

  const capture = yield* parseCapture(new TextDecoder().decode(manifest.bytes));

  return { root, manifest, capture };
});

const copyCapture = Effect.fnUntraced(function* (
  input: Effect.Success<ReturnType<typeof loadCapture>>,
  directory: string,
) {
  const fs = yield* FileSystem.FileSystem;

  yield* fs.makeDirectory(directory);

  yield* fs.writeFile(
    path.join(directory, 'capture.json'),
    input.manifest.bytes,
    {
      flag: 'wx',
    },
  );

  for (const artifact of input.capture.artifacts) {
    if (artifact.path.split('/')[0] === 'capture.json') {
      continue;
    }

    const verified = yield* readVerifiedArtifact(input.root, artifact);

    if (verified.kind === 'unavailable') {
      continue;
    }

    const destination = path.join(directory, artifact.path);

    yield* fs.makeDirectory(path.dirname(destination), { recursive: true });

    yield* fs.writeFile(destination, verified.bytes, { flag: 'wx' });
  }
});

const listViewerFiles = Effect.fnUntraced(function* (
  directory: string,
  prefix: string = '',
): Effect.fn.Return<string[], EvidenceIoError | ExportFailure> {
  const entries = yield* nodeIo(() =>
    readdir(directory, { withFileTypes: true }),
  );

  const files: string[] = [];

  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name);

    if (entry.isDirectory()) {
      files.push(
        ...(yield* listViewerFiles(path.join(directory, entry.name), relative)),
      );
    } else if (entry.isFile()) {
      files.push(relative);
    } else {
      return yield* new ExportFailure({
        message: `Unsupported viewer entry: ${relative}`,
      });
    }
  }

  return files.sort();
});

function contains(root: string, directory: string): boolean {
  const relative = path.relative(root, directory);

  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

export const exportComparison = Effect.fn('exportComparison')(function* ({
  baseDirectory,
  candidateDirectory,
  directory,
  projectRoot,
}: {
  baseDirectory: string | null;
  candidateDirectory: string;
  directory: string;
  projectRoot: string;
}) {
  const fs = yield* FileSystem.FileSystem;

  let candidateIssue: string | undefined;

  const candidate = yield* loadCapture(candidateDirectory).pipe(
    Effect.catchTags({
      ExportFailure: (error) => {
        candidateIssue = `Candidate unavailable: ${error.message}`;

        return Effect.succeed(null);
      },
      PlatformError: (error) => {
        candidateIssue = `Candidate unavailable: ${error.message}`;

        return Effect.succeed(null);
      },
      SchemaError: () => {
        candidateIssue = 'Candidate manifest is malformed or unsupported';

        return Effect.succeed(null);
      },
    }),
  );

  let baseIssue: string | undefined;

  const base =
    baseDirectory === null
      ? null
      : yield* loadCapture(baseDirectory).pipe(
          Effect.catchTags({
            ExportFailure: (error) => {
              baseIssue = `Baseline unavailable: ${error.message}`;

              return Effect.succeed(null);
            },
            PlatformError: (error) => {
              baseIssue = `Baseline unavailable: ${error.message}`;

              return Effect.succeed(null);
            },
            SchemaError: () => {
              baseIssue = 'Baseline manifest is malformed or unsupported';

              return Effect.succeed(null);
            },
          }),
        );

  const parent = yield* fs.realPath(path.dirname(path.resolve(directory)));

  const destination = path.join(parent, path.basename(path.resolve(directory)));

  const project = yield* fs.realPath(projectRoot);

  const viewer = path.join(project, 'dist', 'viewer');

  if (
    (candidate !== null && contains(candidate.root, destination)) ||
    (base !== null && contains(base.root, destination)) ||
    contains(viewer, destination)
  ) {
    return yield* new ExportFailure({
      message: 'Export directory must be outside its inputs',
    });
  }

  const viewerFiles = yield* listViewerFiles(viewer);

  const assets: {
    path: string;
    sha256: string;
    bytes: Uint8Array<ArrayBuffer>;
  }[] = [];

  for (const file of viewerFiles) {
    yield* Schema.decodeUnknownEffect(viewerPath)(file);

    const asset = yield* readVerifiedArtifact(project, {
      id: file,
      path: `dist/viewer/${file}`,
      description: 'Built viewer asset',
    });

    if (asset.kind === 'unavailable') {
      return yield* new ExportFailure({
        message: `Viewer asset unavailable: ${file}: ${asset.reason}`,
      });
    }

    assets.push({ path: file, sha256: asset.hash, bytes: asset.bytes });
  }

  if (!assets.some((asset) => asset.path === 'index.html')) {
    return yield* new ExportFailure({
      message: 'Build the viewer before exporting',
    });
  }

  yield* fs.makeDirectory(destination, { mode: 0o700 });

  if (candidate !== null) {
    yield* copyCapture(candidate, path.join(destination, 'candidate'));
  }

  if (base !== null) {
    yield* copyCapture(base, path.join(destination, 'base'));
  }

  const evaluatedAt = DateTime.formatIso(yield* DateTime.now);

  const selection = yield* Schema.decodeUnknownEffect(selectionSchema)({
    schemaVersion: 1,
    evaluatedAt,
    ...(baseIssue === undefined ? {} : { baseIssue }),
    ...(candidateIssue === undefined ? {} : { candidateIssue }),
    base:
      base === null
        ? null
        : {
            manifestHash: base.manifest.hash,
            sourceHash: base.capture.source.sha256,
          },
    candidate:
      candidate === null
        ? null
        : {
            manifestHash: candidate.manifest.hash,
            sourceHash: candidate.capture.source.sha256,
          },
  } satisfies Selection);

  yield* fs.writeFileString(
    path.join(destination, 'selection.json'),
    json(selection),
    { flag: 'wx' },
  );

  const result = yield* inspectComparison({
    baseDirectory: base === null ? null : path.join(destination, 'base'),
    candidateDirectory: path.join(destination, 'candidate'),
    evaluatedAt,
    selection,
  });

  const report = `> Archival report. Evidence inspected at ${evaluatedAt}. Start the local viewer to inspect the current bundle.\n\n${renderComparison(result)}`;

  yield* fs.writeFileString(
    path.join(destination, 'result.json'),
    json(result),
    { flag: 'wx' },
  );

  yield* fs.writeFileString(path.join(destination, 'report.md'), report, {
    flag: 'wx',
  });

  for (const asset of assets) {
    const output = path.join(destination, asset.path);

    yield* fs.makeDirectory(path.dirname(output), { recursive: true });

    yield* fs.writeFile(output, asset.bytes, { flag: 'wx' });
  }

  const integrity = yield* Schema.decodeUnknownEffect(viewerIntegritySchema)({
    schemaVersion: 1,
    assets: assets.map(({ path: file, sha256: hash }) => ({
      path: file,
      sha256: hash,
    })),
    reportHash: sha256(report),
  });

  yield* fs.writeFileString(
    path.join(destination, 'viewer-integrity.json'),
    json(integrity),
    { flag: 'wx' },
  );

  return { directory: destination, result };
});
