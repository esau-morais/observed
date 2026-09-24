import { DateTime, Effect, FileSystem, Schema } from 'effect';
import { constants } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  digest,
  parseCapture,
  sourceFailureSchema,
  text,
  type CaptureArtifact,
} from './capture/model';
import { json, sha256 } from './encoding';
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

const loadCapture = Effect.fnUntraced(function* (root: string) {
  const manifest = yield* readVerifiedArtifact(root, {
    id: 'capture',
    path: 'capture.json',
    description: 'Capture manifest',
  });

  if (manifest.kind === 'unavailable') {
    const failure = yield* readVerifiedArtifact(root, {
      id: 'source-failure',
      path: 'source-failure.json',
      description: 'Source selection failure',
    });

    if (failure.kind === 'available') {
      const details = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(sourceFailureSchema),
      )(new TextDecoder().decode(failure.bytes));

      return yield* new ExportFailure({
        message: `Requested source ${JSON.stringify(details.revision)} could not be captured: ${details.reason}`,
      });
    }

    return yield* new ExportFailure({
      message: `Capture unavailable: ${manifest.reason}`,
    });
  }

  const capture = yield* parseCapture(new TextDecoder().decode(manifest.bytes));

  return { root, manifest, capture };
});

type FailureArtifact = { artifact: CaptureArtifact; bytes: Uint8Array };

const loadSide = Effect.fnUntraced(
  function* (directory: string, label: string) {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.realPath(directory);
    const loaded = yield* loadCapture(root).pipe(
      Effect.map((capture) => ({ kind: 'captured', ...capture }) as const),
      Effect.catchTags({
        ExportFailure: (error) =>
          Effect.succeed({
            kind: 'unavailable',
            issue: `${label} unavailable: ${error.message}`,
          } as const),
        SchemaError: () =>
          Effect.succeed({
            kind: 'unavailable',
            issue: `${label} manifest is malformed or unsupported`,
          } as const),
      }),
    );

    if (loaded.kind === 'captured') {
      return loaded;
    }

    const artifacts: FailureArtifact[] = [];
    for (const [id, filename, description] of [
      ['source-failure', 'source-failure.json', 'Source selection failure'],
      [
        'source-transcript',
        'source-transcript.jsonl',
        'Source revision selection',
      ],
      ['owner', 'owner.json', 'Run ownership'],
    ] as const) {
      const artifact = { id, path: filename, description };
      const read = yield* readVerifiedArtifact(root, artifact);
      if (read.kind === 'available') {
        artifacts.push({
          artifact: { ...artifact, sha256: read.hash },
          bytes: read.bytes,
        });
      }
    }

    return { ...loaded, root, artifacts };
  },
  (effect, _directory, label) =>
    effect.pipe(
      Effect.catchTag('PlatformError', (error) =>
        Effect.succeed({
          kind: 'unavailable',
          root: null,
          issue: `${label} unavailable: ${error.message}`,
          artifacts: Array<FailureArtifact>(),
        } as const),
      ),
    ),
);

const copyCapture = Effect.fnUntraced(function* (
  input: Effect.Success<ReturnType<typeof loadSide>>,
  directory: string,
) {
  const fs = yield* FileSystem.FileSystem;

  yield* fs.makeDirectory(directory);

  if (input.kind === 'unavailable') {
    for (const { artifact, bytes } of input.artifacts) {
      yield* fs.writeFile(path.join(directory, artifact.path), bytes, {
        flag: 'wx',
      });
    }

    return;
  }

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
  mode = 'comparison',
}: {
  baseDirectory: string | null;
  candidateDirectory: string;
  directory: string;
  projectRoot: string;
  mode?: 'preview' | 'comparison';
}) {
  const fs = yield* FileSystem.FileSystem;
  const candidate = yield* loadSide(candidateDirectory, 'Candidate');
  const base =
    baseDirectory === null ? null : yield* loadSide(baseDirectory, 'Baseline');

  const parent = yield* fs.realPath(path.dirname(path.resolve(directory)));
  const destination = path.join(parent, path.basename(path.resolve(directory)));
  const project = yield* fs.realPath(projectRoot);
  const viewer = path.join(project, 'dist', 'viewer');

  if (
    (candidate.root !== null && contains(candidate.root, destination)) ||
    (base !== null && base.root !== null && contains(base.root, destination)) ||
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

  yield* copyCapture(candidate, path.join(destination, 'candidate'));

  if (base !== null) {
    yield* copyCapture(base, path.join(destination, 'base'));
  }

  const evaluatedAt = DateTime.formatIso(yield* DateTime.now);

  const selection = yield* Schema.decodeUnknownEffect(selectionSchema)({
    schemaVersion: 1,
    mode,
    evaluatedAt,
    ...(base?.kind === 'unavailable'
      ? {
          baseIssue: base.issue,
          baseFailureArtifacts: base.artifacts.map((item) => item.artifact),
        }
      : {}),
    ...(candidate.kind === 'unavailable'
      ? {
          candidateIssue: candidate.issue,
          candidateFailureArtifacts: candidate.artifacts.map(
            (item) => item.artifact,
          ),
        }
      : {}),
    base:
      base?.kind !== 'captured'
        ? null
        : {
            manifestHash: base.manifest.hash,
            sourceHash: base.capture.source.sha256,
          },
    candidate:
      candidate.kind !== 'captured'
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
