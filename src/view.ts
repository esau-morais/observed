import { Effect, FileSystem, Schema } from 'effect';
import path from 'node:path';
import { parseCapture, type CaptureArtifact } from './capture/model';
import { json, sha256 } from './encoding';
import { inspectComparison } from './comparison';
import { selectionSchema, type Selection } from './comparison-model';
import { readVerifiedArtifact } from './evidence';
import { viewerIntegritySchema } from './export';

export class ViewFailure extends Schema.TaggedError<ViewFailure>()(
  'ViewFailure',
  { message: Schema.String },
) {}

type Asset = {
  bytes: Uint8Array<ArrayBuffer>;
  type: string;
  evidence: boolean;
};

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const readRequired = Effect.fnUntraced(function* (
  root: string,
  file: string,
  hash?: string,
) {
  const read = yield* readVerifiedArtifact(root, {
    id: file,
    path: file,
    description: file,
    ...(hash === undefined ? {} : { sha256: hash }),
  });

  if (read.kind === 'unavailable') {
    return yield* new ViewFailure({ message: `${file}: ${read.reason}` });
  }

  return read.bytes;
});

function evidenceType(file: string, bytes: Uint8Array): string {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];

  return path.extname(file).toLowerCase() === '.png' &&
    signature.every((value, index) => bytes[index] === value)
    ? 'image/png'
    : 'text/plain; charset=utf-8';
}

const stageCapture = Effect.fnUntraced(function* (
  root: string,
  staging: string,
  prefix: 'base' | 'candidate',
  expected: NonNullable<Selection['base']>,
  assets: Map<string, Asset>,
) {
  const fs = yield* FileSystem.FileSystem;
  const destination = path.join(staging, prefix);

  yield* fs.makeDirectory(destination);

  const manifest = yield* readVerifiedArtifact(root, {
    id: 'capture',
    path: `${prefix}/capture.json`,
    description: 'Selected capture manifest',
    sha256: expected.manifestHash,
  });

  if (manifest.kind === 'unavailable') {
    return;
  }

  yield* fs.writeFile(path.join(destination, 'capture.json'), manifest.bytes, {
    flag: 'wx',
  });

  const capture = yield* parseCapture(
    new TextDecoder().decode(manifest.bytes),
  ).pipe(
    Effect.catchTags({
      SchemaError: () => Effect.succeed(null),
      UnsupportedCapture: () => Effect.succeed(null),
    }),
  );

  if (capture === null) {
    return;
  }

  yield* stageArtifacts(root, staging, prefix, capture.artifacts, assets);
});

const stageArtifacts = Effect.fnUntraced(function* (
  root: string,
  staging: string,
  prefix: 'base' | 'candidate',
  artifacts: readonly CaptureArtifact[],
  assets: Map<string, Asset>,
) {
  const fs = yield* FileSystem.FileSystem;

  for (const artifact of artifacts) {
    if (artifact.path.split('/')[0] === 'capture.json') {
      continue;
    }

    const file = `${prefix}/${artifact.path}`;
    const read = yield* readVerifiedArtifact(root, { ...artifact, path: file });

    if (read.kind === 'unavailable') {
      continue;
    }

    const output = path.join(staging, file);

    yield* fs.makeDirectory(path.dirname(output), { recursive: true });

    yield* fs.writeFile(output, read.bytes, { flag: 'wx' });

    assets.set(`/${file.split('/').map(encodeURIComponent).join('/')}`, {
      bytes: read.bytes,
      type: evidenceType(file, read.bytes),
      evidence: true,
    });
  }
});

const preloadReport = Effect.fnUntraced(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.realPath(directory);
  const selectionBytes = yield* readRequired(root, 'selection.json');

  const selection = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(selectionSchema),
    {
      onExcessProperty: 'error',
    },
  )(new TextDecoder().decode(selectionBytes));

  const integrityBytes = yield* readRequired(root, 'viewer-integrity.json');

  const integrity = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(viewerIntegritySchema),
    {
      onExcessProperty: 'error',
    },
  )(new TextDecoder().decode(integrityBytes));

  const assets = new Map<string, Asset>();

  for (const asset of integrity.assets) {
    const bytes = yield* readRequired(root, asset.path, asset.sha256);

    assets.set(`/${asset.path}`, {
      bytes,
      type:
        contentTypes[path.extname(asset.path)] ?? 'application/octet-stream',
      evidence: false,
    });
  }

  const report = yield* readRequired(root, 'report.md', integrity.reportHash);

  assets.set('/report.md', {
    bytes: report,
    type: 'text/plain; charset=utf-8',
    evidence: true,
  });

  const staging = yield* fs.makeTempDirectoryScoped({
    prefix: 'observed-view-',
  });

  if (selection.candidate !== null) {
    yield* stageCapture(
      root,
      staging,
      'candidate',
      selection.candidate,
      assets,
    );
  }

  if (selection.base !== null) {
    yield* stageCapture(root, staging, 'base', selection.base, assets);
  }

  if (selection.candidate === null) {
    yield* stageArtifacts(
      root,
      staging,
      'candidate',
      selection.candidateFailureArtifacts ?? [],
      assets,
    );
  }

  if (selection.base === null) {
    yield* stageArtifacts(
      root,
      staging,
      'base',
      selection.baseFailureArtifacts ?? [],
      assets,
    );
  }

  const { result, visualDiff } = yield* inspectComparison({
    baseDirectory:
      selection.base === null && selection.baseIssue === undefined
        ? null
        : path.join(staging, 'base'),
    candidateDirectory: path.join(staging, 'candidate'),
    evaluatedAt: selection.evaluatedAt,
    selection,
  });

  if (visualDiff !== null) {
    assets.set(`/${visualDiff.path}`, {
      bytes: yield* readRequired(
        root,
        visualDiff.path,
        sha256(visualDiff.bytes),
      ),
      type: 'image/png',
      evidence: true,
    });
  }

  assets.set('/result.json', {
    bytes: new TextEncoder().encode(json(result)),
    type: 'application/json; charset=utf-8',
    evidence: false,
  });

  return assets;
}, Effect.scoped);

const policy = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ');

export const serveReport = Effect.fn('serveReport')(function* ({
  directory,
  port,
}: {
  directory: string;
  port: number;
}) {
  yield* Schema.decodeUnknownEffect(
    Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(0),
      Schema.isLessThanOrEqualTo(65535),
    ),
  )(port);

  const assets = yield* preloadReport(directory);

  const server = yield* Effect.acquireRelease(
    Effect.try({
      try: () =>
        Bun.serve({
          hostname: '127.0.0.1',
          port,
          fetch(request) {
            const headers = new Headers({
              'Cache-Control': 'no-store',
              'Content-Security-Policy': policy,
              'X-Content-Type-Options': 'nosniff',
              'Referrer-Policy': 'no-referrer',
            });

            if (request.method !== 'GET' && request.method !== 'HEAD') {
              headers.set('Allow', 'GET, HEAD');

              return new Response(null, { status: 405, headers });
            }

            const pathname = new URL(request.url).pathname;

            const asset = assets.get(
              pathname === '/' ? '/index.html' : pathname,
            );

            if (asset === undefined) {
              return new Response(null, { status: 404, headers });
            }

            headers.set('Content-Type', asset.type);

            headers.set('Content-Length', String(asset.bytes.byteLength));

            if (asset.evidence) {
              headers.set(
                'Content-Security-Policy',
                "default-src 'none'; sandbox",
              );
            }

            return new Response(
              request.method === 'HEAD' ? null : asset.bytes,
              { headers },
            );
          },
        }),
      catch: (error) =>
        new ViewFailure({
          message:
            error instanceof Error
              ? error.message
              : 'Report server failed to start',
        }),
    }),
    (owned) => Effect.promise(() => owned.stop(true)),
  );

  return server.url.toString();
});
