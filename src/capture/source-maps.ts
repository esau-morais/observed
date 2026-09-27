import { Effect, FileSystem, Option, Schema } from 'effect';
import path from 'node:path';
import { json } from '../encoding';
import { evidenceKinds } from '../evidence-kinds';
import { redactText } from '../redact';
import {
  applicationScript,
  parseSourceMap,
  sourceMapIndexPath,
  stackFrames,
  type SourceMapIndex,
} from '../source-map';

const maxScripts = 20;
const maxBytes = 32 * 1024 * 1024;
const timeoutMs = 10_000;

type Fetched =
  { kind: 'body'; text: string } | { kind: 'failed'; reason: string };

// Same origin only and no redirects: the capture must not reach beyond the
// application it started.
const download = (url: URL) =>
  Effect.tryPromise({
    try: async (signal): Promise<Fetched> => {
      const response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      });

      if (response.status !== 200) {
        await response.body?.cancel();

        return { kind: 'failed', reason: `HTTP ${response.status}` };
      }

      const declared = Number(response.headers.get('content-length'));

      if (declared > maxBytes) {
        await response.body?.cancel();

        return { kind: 'failed', reason: 'larger than 32 MB' };
      }

      const bytes = new Uint8Array(await response.arrayBuffer());

      return bytes.byteLength > maxBytes
        ? { kind: 'failed', reason: 'larger than 32 MB' }
        : { kind: 'body', text: new TextDecoder().decode(bytes) };
    },
    catch: () => 'request failed',
  }).pipe(
    Effect.catch((reason) =>
      Effect.succeed<Fetched>({ kind: 'failed', reason }),
    ),
  );

const sourceMappingUrl = /\/\/[#@] sourceMappingURL=(\S+)\s*$/;

function lastMappingUrl(script: string): string | null {
  const tail = script.slice(-4096).split('\n').reverse();

  for (const line of tail) {
    const match = sourceMappingUrl.exec(line);

    if (match?.[1] !== undefined) {
      return match[1];
    }
  }

  return null;
}

function inlineMap(url: string): string | null {
  const match =
    /^data:application\/json(?:;charset=[\w-]+)?;base64,(.*)$/i.exec(url);

  return match?.[1] === undefined
    ? null
    : Buffer.from(match[1], 'base64').toString('utf8');
}

type Found =
  | {
      kind: 'found';
      text: string;
      via: 'adjacent' | 'sourceMappingURL' | 'inline';
    }
  | { kind: 'missing'; reason: string };

const missing = (reason: string): Found => ({ kind: 'missing', reason });

const found = (
  text: string,
  via: 'adjacent' | 'sourceMappingURL' | 'inline',
): Found => ({ kind: 'found', text, via });

const mapIn = (
  text: string,
  via: 'sourceMappingURL' | 'inline',
  where: string,
): Found =>
  parseSourceMap(text) === null
    ? missing(`${where} is not a version 3 source map`)
    : found(text, via);

// A hidden map sits next to its script without a sourceMappingURL comment,
// so the adjacent `.map` is tried first.
const findMap = Effect.fnUntraced(function* (script: URL) {
  const adjacent = yield* download(new URL(`${script.pathname}.map`, script));

  if (adjacent.kind === 'body' && parseSourceMap(adjacent.text) !== null) {
    return found(adjacent.text, 'adjacent');
  }

  const adjacentReason =
    adjacent.kind === 'failed'
      ? `${script.pathname}.map: ${adjacent.reason}`
      : `${script.pathname}.map is not a version 3 source map`;
  const body = yield* download(script);

  if (body.kind === 'failed') {
    return missing(`${adjacentReason}; the script itself: ${body.reason}`);
  }

  const named = lastMappingUrl(body.text);

  if (named === null) {
    return missing(
      `${adjacentReason}, and the script names no sourceMappingURL`,
    );
  }

  const inline = inlineMap(named);

  if (inline !== null) {
    return mapIn(inline, 'inline', 'The inline source map');
  }

  const target = URL.parse(named, script);

  if (target?.origin !== script.origin) {
    return missing(
      `${adjacentReason}, and its sourceMappingURL is outside the application's origin`,
    );
  }

  const linked = yield* download(target);

  return linked.kind === 'failed'
    ? missing(`${adjacentReason}; ${target.pathname}: ${linked.reason}`)
    : mapIn(linked.text, 'sourceMappingURL', target.pathname);
});

const readEvidence = Effect.fnUntraced(function* <T>(
  directory: string,
  kind: string,
  schema: Schema.Codec<T, unknown>,
) {
  const fs = yield* FileSystem.FileSystem;
  const filename = path.join(directory, 'evidence', `${kind}.json`);

  if (!(yield* fs.exists(filename))) {
    return null;
  }

  return Option.getOrNull(
    Schema.decodeUnknownOption(Schema.fromJsonString(schema))(
      yield* fs.readFileString(filename),
    ),
  );
});

// Scripts named by error frames and React sources, in the order found.
const scriptsToMap = Effect.fnUntraced(function* (
  directory: string,
  origin: string,
) {
  const errors = yield* readEvidence(
    directory,
    'browser-errors',
    evidenceKinds['browser-errors'].file,
  );
  const react = yield* readEvidence(
    directory,
    'react',
    evidenceKinds.react.file,
  );
  const scripts = [
    ...(errors?.value.entries ?? []).flatMap((entry) =>
      stackFrames(entry.text).map((frame) =>
        applicationScript(frame.url, origin),
      ),
    ),
    ...(react?.value.sources ?? []).map((source) =>
      source.script.startsWith('/') ? source.script : null,
    ),
  ].filter((script): script is string => script !== null);

  return [...new Set(scripts)];
});

// Fetches the source map of every application script that evidence points
// into, while the application still runs. Anchors are resolved later, when
// the captures are compared.
export const recordSourceMaps = Effect.fn('recordSourceMaps')(
  function* (options: {
    directory: string;
    url: string;
    concealed: readonly string[];
    addArtifact: (id: string, filename: string, description: string) => void;
  }) {
    const fs = yield* FileSystem.FileSystem;
    const origin = new URL(options.url).origin;
    const scripts = yield* scriptsToMap(options.directory, origin);
    const entries: SourceMapIndex['scripts'][number][] = [];

    for (const [index, script] of scripts.entries()) {
      if (index >= maxScripts) {
        entries.push({
          script,
          map: {
            kind: 'unavailable',
            reason: `Only the first ${maxScripts} scripts are mapped`,
          },
        });
        continue;
      }

      const found = yield* findMap(new URL(script, origin));

      if (found.kind === 'missing') {
        entries.push({
          script,
          map: {
            kind: 'unavailable',
            reason: `No source map: ${found.reason}`,
          },
        });
        continue;
      }

      const filename = `source-maps/${index + 1}-${path.posix.basename(script)}.map`;

      yield* fs.makeDirectory(path.join(options.directory, 'source-maps'), {
        recursive: true,
      });
      yield* fs.writeFileString(
        path.join(options.directory, filename),
        redactText(found.text, options.concealed),
        { flag: 'wx' },
      );
      options.addArtifact(
        `source-map-${index + 1}`,
        filename,
        `Source map for ${script}; credentials redacted`,
      );
      entries.push({
        script,
        map: { kind: 'recorded', path: filename, via: found.via },
      });
    }

    yield* fs.writeFileString(
      path.join(options.directory, sourceMapIndexPath),
      json({
        schemaVersion: 1,
        origin,
        scripts: entries,
      } satisfies SourceMapIndex),
      { flag: 'wx' },
    );
    options.addArtifact(
      'source-maps',
      sourceMapIndexPath,
      'Source maps fetched for scripts named by error frames and React sources',
    );
  },
);
