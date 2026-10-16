import {
  conclusionExitCodes,
  inspectComparison,
  json,
  selectionSchema,
  selectionSchemaVersion,
  sha256,
  type CaptureArtifact,
  type JourneySelection,
} from '@observed/judge';
import { DateTime, Effect, FileSystem, Schema } from 'effect';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { CaptureFailure, captureJourney } from './capture';
import { runLayout, type Side } from './layout';
import { loadProject, loadProjectAt, readBaseJourneys } from './project';
import { observedProvenance } from './provenance';
import { prepareRevision, revisionFiles, type PreparedRevision } from './revision';

const elapsed = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const started = performance.now();
    const value = yield* effect;

    return { value, ms: Math.round(performance.now() - started) };
  });

const sides = ['base', 'candidate'] as const satisfies readonly Side[];

export const runComparison = Effect.fn('runComparison')(function* (options: {
  projectRoot: string;
  base: string;
  candidate: string | null;
  output: string;
  timeoutMs?: number;
}) {
  const fs = yield* FileSystem.FileSystem;
  const started = performance.now();
  const timeoutMs = options.timeoutMs ?? 120_000;
  const layout = runLayout(path.resolve(options.output));

  yield* fs.makeDirectory(path.dirname(layout.root), { recursive: true });
  yield* fs.makeDirectory(layout.root, { mode: 0o700 });

  const { root, project, journeys, recipes } =
    options.candidate === null
      ? yield* loadProject(options.projectRoot)
      : yield* loadProjectAt({
          projectRoot: options.projectRoot,
          revision: options.candidate,
          transcript: path.join(layout.root, 'candidate-project-transcript.jsonl'),
        });

  const recipeSources = {
    base: yield* readBaseJourneys({
      projectRoot: root,
      baseRevision: options.base,
      transcript: path.join(layout.root, 'base-project-transcript.jsonl'),
    }),
    candidate: journeys,
  };
  const observed = yield* observedProvenance({
    projectRoot: root,
    transcript: path.join(layout.root, 'observed-transcript.jsonl'),
  });
  const prepare = (revision: string | null) =>
    elapsed(prepareRevision({ projectRoot: root, project, revision, timeoutMs }));
  const prepared = yield* Effect.all([prepare(options.base), prepare(options.candidate)], {
    concurrency: 'unbounded',
  });

  const browsers = new Map<string, Browser>();
  yield* Effect.addFinalizer(() =>
    Effect.tryPromise(() =>
      Promise.all([...browsers.values()].map((browser) => browser.close())),
    ).pipe(
      Effect.timeout('10 seconds'),
      Effect.catch((error) => Effect.logWarning('Chromium did not close', error)),
    ),
  );
  const browserFor = (args: readonly string[]) =>
    Effect.tryPromise({
      try: async () => {
        const key = JSON.stringify(args);
        const open =
          browsers.get(key) ?? (await chromium.launch({ headless: true, args: [...args] }));
        browsers.set(key, open);

        return open;
      },
      catch: (cause) =>
        new CaptureFailure({
          category: 'producer',
          message: `Chromium could not start: ${cause instanceof Error ? (cause.message.split('\n')[0] ?? '') : String(cause)}`,
        }),
    });

  const captures: { journey: number; side: Side; ms: number }[] = [];
  const [base, candidate] = prepared;
  const preparedFor = { base: base.value, candidate: candidate.value };

  const selected = yield* Effect.forEach(recipes, (recipe, index) =>
    Effect.gen(function* () {
      yield* fs.makeDirectory(path.join(layout.root, layout.journey(index)));
      const chosen: { -readonly [K in keyof JourneySelection]?: JourneySelection[K] } = {};

      for (const side of sides) {
        const revision = preparedFor[side];
        const directory = layout.capture(index, side);

        if (revision.kind === 'source-failed') {
          Object.assign(chosen, yield* sourceFailure(directory, side, revision));
          continue;
        }

        const capture = yield* elapsed(
          captureJourney({
            directory,
            revision,
            project,
            recipe,
            browser: browserFor(recipe.browserArguments),
            observed,
            label: side === 'base' ? 'Base' : 'Candidate',
            timeoutMs,
          }),
        );
        captures.push({ journey: index + 1, side, ms: capture.ms });
        chosen[side] = {
          manifestHash: sha256(yield* fs.readFile(path.join(directory, 'capture.json'))),
          sourceHash: capture.value.source.sha256,
        };
      }

      return {
        base: null,
        candidate: null,
        ...chosen,
        directory: layout.journey(index),
      } satisfies JourneySelection;
    }),
  );

  const selection = yield* Schema.decodeUnknownEffect(selectionSchema)({
    schemaVersion: selectionSchemaVersion,
    evaluatedAt: DateTime.formatIso(yield* DateTime.now),
    mode: 'comparison',
    journeys: selected,
    recipes: recipeSources,
  });
  yield* fs.writeFileString(layout.selection, json(selection), { flag: 'wx' });

  const judged = yield* elapsed(inspectComparison({ root: layout.root, selection }));
  const { result, visualDiffs } = judged.value;

  for (const diff of visualDiffs) {
    yield* fs.writeFile(path.join(layout.root, diff.path), diff.bytes, { flag: 'wx' });
  }

  yield* fs.writeFileString(layout.result, json(result), { flag: 'wx' });
  yield* fs.writeFileString(
    layout.timings,
    json({
      prepare: { base: base.ms, candidate: candidate.ms },
      captures,
      judge: judged.ms,
      total: Math.round(performance.now() - started),
    }),
    { flag: 'wx' },
  );

  return { result, selection, exitCode: conclusionExitCodes[result.conclusion.kind], layout };
}, Effect.scoped);

const sourceFailure = Effect.fnUntraced(function* (
  directory: string,
  side: Side,
  revision: Extract<PreparedRevision, { kind: 'source-failed' }>,
) {
  const fs = yield* FileSystem.FileSystem;
  const reason = { revision: revision.revision ?? 'worktree', reason: revision.reason };
  const files = [
    ['source-failure', 'source-failure.json', 'Source selection failure', json(reason)],
    [
      'source-transcript',
      'source-transcript.jsonl',
      'Source revision selection',
      yield* fs.readFileString(path.join(revision.directory, revisionFiles.sourceTranscript)),
    ],
  ] as const;
  const artifacts: CaptureArtifact[] = [];

  yield* fs.makeDirectory(directory);

  for (const [id, filename, description, text] of files) {
    yield* fs.writeFileString(path.join(directory, filename), text, { flag: 'wx' });
    artifacts.push({ id, path: filename, description, sha256: sha256(text) });
  }

  const issue = `${side === 'base' ? 'Base' : 'Candidate'} unavailable: Requested source ${JSON.stringify(reason.revision)} could not be captured: ${reason.reason}`;

  return side === 'base'
    ? { baseIssue: issue, baseFailureArtifacts: artifacts }
    : { candidateIssue: issue, candidateFailureArtifacts: artifacts };
});
