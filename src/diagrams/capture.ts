import { Effect, FileSystem, Schema } from 'effect';
import path from 'node:path';
import { devDependencies } from '../../package.json';
import { commitSchema } from '../capture/model';
import { gitEnvironment, processOutput } from '../capture/process';
import type { GitChanges } from '../comparison-model';
import { json, sha256 } from '../encoding';
import { agentBrowserPath, packaged } from '../installation';
import { changedMermaidBlocks } from './markdown';
import {
  diagramManifestSchema,
  type DiagramManifest,
  type DiagramSide,
} from './model';

export const diagramProducer = {
  name: 'mermaid',
  version: devDependencies.mermaid,
} as const;

const renderingSchema = Schema.Struct({
  success: Schema.Literal(true),
  data: Schema.Struct({
    result: Schema.Union([
      Schema.Struct({
        kind: Schema.Literal('rendered'),
        svg: Schema.NonEmptyString,
      }),
      Schema.Struct({
        kind: Schema.Literal('unavailable'),
        reason: Schema.NonEmptyString,
      }),
    ]),
  }),
});

class DiagramFailure extends Schema.TaggedError<DiagramFailure>()(
  'DiagramFailure',
  { message: Schema.String },
) {}

const renderer = Effect.fnUntraced(function* (toolRoot: string) {
  const fs = yield* FileSystem.FileSystem;
  if (packaged !== null) {
    return yield* fs.readFileString(
      path.join(toolRoot, 'dist/diagrams/renderer.js'),
    );
  }

  const output = yield* Effect.tryPromise({
    try: () =>
      Bun.build({
        entrypoints: [path.join(toolRoot, 'src/diagrams/browser.ts')],
        target: 'browser',
        format: 'iife',
        minify: true,
      }),
    catch: (error) => new DiagramFailure({ message: String(error) }),
  });
  const file = output.outputs[0];
  if (!output.success || file === undefined) {
    return yield* new DiagramFailure({
      message: 'The Mermaid renderer could not be built',
    });
  }

  return yield* Effect.tryPromise({
    try: () => file.text(),
    catch: (error) => new DiagramFailure({ message: String(error) }),
  });
});

const browser = Effect.fnUntraced(function* (options: {
  toolRoot: string;
  transcript: string;
  browserArguments: readonly string[];
}) {
  const fs = yield* FileSystem.FileSystem;
  const temporary = yield* fs.makeTempDirectoryScoped({
    prefix: 'observed-diagrams-',
  });
  const config = path.join(temporary, 'browser-config.json');
  yield* fs.writeFileString(config, '{}\n');
  const script = yield* renderer(options.toolRoot);
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch(request) {
          if (new URL(request.url).pathname === '/renderer.js') {
            return new Response(script, {
              headers: { 'Content-Type': 'text/javascript' },
            });
          }

          return new Response(
            '<!doctype html><meta charset="utf-8"><title>Observed diagram</title><style>body{margin:0;padding:16px;background:white;color:#152328}#diagram{display:inline-block;padding:8px;max-width:1400px}</style><div id="diagram"></div><script src="/renderer.js"></script>',
            {
              headers: {
                'Content-Type': 'text/html',
                'Content-Security-Policy':
                  "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'",
              },
            },
          );
        },
      }),
    ),
    (server) => Effect.promise(() => server.stop(true)),
  );
  const run = (args: readonly string[]) =>
    processOutput({
      command: process.execPath,
      args: [
        agentBrowserPath(options.toolRoot),
        '--config',
        config,
        '--session',
        path.basename(temporary),
        '--headed',
        'false',
        '--no-webmcp',
        '--idle-timeout',
        '60s',
        ...(options.browserArguments.length === 0
          ? []
          : ['--args', options.browserArguments.join(',')]),
        ...args,
      ],
      cwd: temporary,
      env: {
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        LANG: 'en_US.UTF-8',
        TZ: 'UTC',
        TMPDIR: temporary,
        AGENT_BROWSER_SOCKET_DIR: temporary,
        AGENT_BROWSER_DEFAULT_TIMEOUT: '20000',
      },
      transcript: options.transcript,
      timeoutMs: 30_000,
    });
  yield* Effect.addFinalizer(() => run(['close']).pipe(Effect.ignore));
  yield* run(['open', server.url.href]);
  yield* run(['set', 'viewport', '1440', '1000']);

  return run;
});

export const captureDiagrams = Effect.fn('captureDiagrams')(
  function* (options: {
    projectRoot: string;
    toolRoot: string;
    directory: string;
    baseRevision: string;
    candidateRevision: string | null;
    changes: GitChanges;
    resultHash: string;
    browserArguments: readonly string[];
  }) {
    const fs = yield* FileSystem.FileSystem;
    const transcript = path.join(
      options.directory,
      'diagrams-transcript.jsonl',
    );
    const collect = Effect.gen(function* () {
      if (options.candidateRevision === null) {
        return {
          kind: 'not-run',
          reason:
            'Diagram observations need a base and candidate commit; the candidate is a worktree.',
        } as const;
      }

      if (options.changes.kind === 'unavailable') {
        return { kind: 'unavailable', reason: options.changes.reason } as const;
      }

      const git = (args: readonly string[]) =>
        processOutput({
          command: 'git',
          args,
          cwd: options.projectRoot,
          env: gitEnvironment(),
          transcript,
        });
      const resolve = (ref: string) =>
        git([
          'rev-parse',
          '--verify',
          '--end-of-options',
          `${ref}^{commit}`,
        ]).pipe(
          Effect.flatMap((value) =>
            Schema.decodeUnknownEffect(commitSchema)(value.trim()),
          ),
        );
      const baseCommit = yield* resolve(options.baseRevision);
      const candidateCommit = yield* resolve(options.candidateRevision);
      const pairs = [];
      for (const file of options.changes.files.filter((file) =>
        /\.(?:md|markdown)$/i.test(file.path),
      )) {
        const repositoryFile = path.posix.normalize(
          path.posix.join(options.changes.projectDirectory, file.path),
        );
        const base =
          file.change === 'added'
            ? ''
            : yield* git(['show', `${baseCommit}:${repositoryFile}`]);
        const candidate =
          file.change === 'removed'
            ? ''
            : yield* git(['show', `${candidateCommit}:${repositoryFile}`]);
        pairs.push(
          ...changedMermaidBlocks(base, candidate).map((pair) => ({
            ...pair,
            file: repositoryFile,
          })),
        );
      }

      const rendered: Extract<
        DiagramManifest['observation'],
        { kind: 'complete' }
      >['pairs'][number][] = [];
      if (pairs.length > 0) {
        yield* fs.makeDirectory(path.join(options.directory, 'diagrams'));
        const run = yield* browser({
          toolRoot: options.toolRoot,
          transcript,
          browserArguments: options.browserArguments,
        });
        for (const [index, pair] of pairs.entries()) {
          const render = (side: 'base' | 'candidate') =>
            Effect.gen(function* () {
              const source = pair[side];
              if (source === null) {
                return { kind: 'absent' } satisfies DiagramSide;
              }

              const response = yield* run([
                'eval',
                `window.renderObservedDiagram(${JSON.stringify(source)})`,
                '--json',
              ]);
              const {
                data: { result },
              } = yield* Schema.decodeUnknownEffect(
                Schema.fromJsonString(renderingSchema),
              )(response);
              if (result.kind === 'unavailable') {
                return result;
              }

              const svg = `diagrams/${index}-${side}.svg`;
              const png = `diagrams/${index}-${side}.png`;
              yield* fs.writeFileString(
                path.join(options.directory, svg),
                result.svg,
                { flag: 'wx' },
              );
              yield* run([
                'screenshot',
                '#diagram',
                path.join(options.directory, png),
              ]);

              return {
                kind: 'rendered',
                svg: { path: svg, sha256: sha256(result.svg) },
                png: {
                  path: png,
                  sha256: sha256(
                    yield* fs.readFile(path.join(options.directory, png)),
                  ),
                },
              } satisfies DiagramSide;
            }).pipe(
              Effect.catch((error) =>
                Effect.succeed({
                  kind: 'unavailable' as const,
                  reason: String(error),
                }),
              ),
            );
          rendered.push({
            file: pair.file,
            heading: pair.heading,
            order: pair.order,
            change: pair.change,
            base: yield* render('base'),
            candidate: yield* render('candidate'),
          });
        }
      }

      return {
        kind: 'complete',
        baseCommit,
        candidateCommit,
        producer: diagramProducer,
        pairs: rendered,
      } as const;
    }).pipe(
      Effect.scoped,
      Effect.catch((error) =>
        Effect.succeed({ kind: 'unavailable' as const, reason: String(error) }),
      ),
    );
    const manifest = yield* Schema.decodeUnknownEffect(diagramManifestSchema)({
      schemaVersion: 1,
      resultHash: options.resultHash,
      observation: yield* collect,
    });
    yield* fs.writeFileString(
      path.join(options.directory, 'diagrams.json'),
      json(manifest),
      { flag: 'wx' },
    );

    return manifest;
  },
);
