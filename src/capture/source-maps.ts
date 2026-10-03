import { Effect, FileSystem, Option, Schema } from 'effect';
import path from 'node:path';
import { json } from '../encoding';
import { evidenceKinds } from '../evidence-kinds';
import { conceal } from '../redact';
import {
  applicationScript,
  parseSourceMap,
  sourceMapIndexPath,
  stackFrames,
  type SourceMapIndex,
} from '../source-map';

// As many as the coverage collector maps, so each map behind its lines is
// kept.
const maxScripts = 100;
const maxBytes = 32 * 1024 * 1024;
const timeoutMs = 5_000;
// Map fetching runs inside the capture's own timeout, so it stops starting
// new fetches after this long.
const deadlineMs = 20_000;

type Fetched =
  { kind: 'body'; text: string } | { kind: 'failed'; reason: string };

async function readLimited(response: Response): Promise<Fetched> {
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  for (;;) {
    const read = await reader?.read();

    if (read === undefined || read.done) {
      return { kind: 'body', text: Buffer.concat(chunks).toString('utf8') };
    }

    size += read.value.byteLength;

    if (size > maxBytes) {
      await reader?.cancel();

      return { kind: 'failed', reason: 'larger than 32 MB' };
    }

    chunks.push(read.value);
  }
}

// Same origin only and no redirects: the capture must not reach beyond the
// application it started. A script path such as `//host/x.js` resolves to
// another host, so the origin is checked on the final URL.
const download = (url: URL, origin: string) =>
  url.origin === origin
    ? Effect.tryPromise({
        try: async (signal): Promise<Fetched> => {
          const response = await fetch(url, {
            redirect: 'manual',
            signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
          });

          if (response.status !== 200) {
            await response.body?.cancel();

            return { kind: 'failed', reason: `HTTP ${response.status}` };
          }

          return await readLimited(response);
        },
        catch: () => 'request failed',
      }).pipe(
        Effect.catch((reason) =>
          Effect.succeed<Fetched>({ kind: 'failed', reason }),
        ),
      )
    : Effect.succeed<Fetched>({
        kind: 'failed',
        reason: "outside the application's origin",
      });

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
export const findSourceMap = Effect.fnUntraced(function* (
  script: URL,
  origin: string,
  text?: string,
) {
  const adjacent = yield* download(
    new URL(`${script.pathname}.map`, script),
    origin,
  );

  if (adjacent.kind === 'body' && parseSourceMap(adjacent.text) !== null) {
    return found(adjacent.text, 'adjacent');
  }

  const adjacentReason =
    adjacent.kind === 'failed'
      ? `${script.pathname}.map: ${adjacent.reason}`
      : `${script.pathname}.map is not a version 3 source map`;
  const body: Fetched =
    text === undefined
      ? yield* download(script, origin)
      : { kind: 'body', text };

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

  const linked = yield* download(target, origin);

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
  const coverage = yield* readEvidence(
    directory,
    'coverage',
    evidenceKinds.coverage.file,
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
    ...(coverage?.value.scripts ?? []).map((script) =>
      script.kind === 'mapped' ? script.script : null,
    ),
  ].filter((script): script is string => script !== null);

  return [...new Set(scripts)];
});

function skipReason(index: number, elapsedMs: number): string | null {
  if (index >= maxScripts) {
    return `Only the first ${maxScripts} scripts are mapped`;
  }

  return elapsedMs > deadlineMs
    ? `Map fetching stopped after ${deadlineMs / 1000} seconds`
    : null;
}

// Fetches the source map of every application script that evidence points
// into or that coverage mapped, while the application still runs. Anchors
// are resolved later, when the captures are compared.
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

    const started = Date.now();

    for (const [index, script] of scripts.entries()) {
      const skipped = skipReason(index, Date.now() - started);

      if (skipped !== null) {
        entries.push({
          script,
          map: { kind: 'unavailable', reason: skipped },
        });
        continue;
      }

      const found = yield* findSourceMap(new URL(script, origin), origin);

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
      // A map holds source text, like the source snapshot, so only concealed
      // values are removed. redactText's traffic rules took 114 seconds on a
      // 1 MB map and changed nothing.
      yield* fs.writeFileString(
        path.join(options.directory, filename),
        conceal(found.text, options.concealed),
        { flag: 'wx' },
      );
      options.addArtifact(
        `source-map-${index + 1}`,
        filename,
        `Source map for ${script}; concealed values removed`,
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
      'Source maps fetched for scripts named by error frames, React sources and coverage',
    );
  },
);
