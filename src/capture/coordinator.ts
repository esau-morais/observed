import { Cause, DateTime, Effect, Exit, FileSystem, Schema } from 'effect';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ApplicationFailure, startApplication, listFiles } from './application';
import { captureBrowser } from './agent-browser';
import { captureSchema, type Capture, type CaptureArtifact } from './model';
import { processOutput } from './process';
import {
  json,
  producer,
  recipe,
  recipeHash,
  recipeText,
  sha256,
} from './recipe';
import { snapshotApplication, type Variant } from './snapshot';

class CaptureFailure extends Schema.TaggedError<CaptureFailure>()(
  'CaptureFailure',
  {
    category: Schema.Literals(['timeout', 'application', 'producer']),
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export const captureApplication = Effect.fn('captureApplication')(
  function* (options: {
    projectRoot: string;
    directory: string;
    variant: Variant;
    timeoutMs?: number;
    stall?: boolean;
  }) {
    const fs = yield* FileSystem.FileSystem;

    const directory = path.resolve(options.directory);

    yield* fs.makeDirectory(directory);

    const id = randomUUID();

    const startedAt = DateTime.formatIso(yield* DateTime.now);

    yield* fs.writeFileString(
      path.join(directory, 'owner.json'),
      json({
        id,
        session: `observed-${id}`,
        startedAt,
        processId: process.pid,
      }),
      { flag: 'wx' },
    );

    const source = yield* snapshotApplication({
      projectRoot: options.projectRoot,
      directory,
      variant: options.variant,
    });

    const artifacts = new Map<string, { path: string; description: string }>();

    for (const file of source.files) {
      artifacts.set(`source-${artifacts.size}`, {
        path: `source/${file.path}`,
        description: `Source snapshot: ${file.path}`,
      });
    }

    const addArtifact = (id: string, filename: string, description: string) => {
      artifacts.set(id, { path: filename, description });
    };

    addArtifact(
      'recipe',
      'recipe.json',
      'Protected saved journey and expectation',
    );

    addArtifact(
      'transcript',
      'transcript.jsonl',
      'Original producer and build command output',
    );

    addArtifact(
      'server-requests',
      'server-requests.json',
      'Application server request ledger',
    );

    addArtifact(
      'server-cleanup',
      'server-cleanup.json',
      'Owned application shutdown',
    );

    addArtifact(
      'browser-cleanup',
      'browser-cleanup.json',
      'Owned browser shutdown',
    );

    addArtifact(
      'owner',
      'owner.json',
      'Run-owned session and process identity',
    );

    let conditions: Capture['conditions'] = {
      kind: 'unavailable',
      reason: 'Browser conditions were not captured',
    };

    let manifest: Capture | undefined;

    const run = Effect.gen(function* () {
      yield* fs.writeFileString(
        path.join(directory, 'recipe.json'),
        recipeText,
        { flag: 'wx' },
      );

      yield* processOutput({
        command: process.execPath,
        args: [
          '--eval',
          yield* fs.readFileString(
            path.join(directory, 'source/src/capture/fixture-build.ts'),
          ),
          'snapshot-builder',
          path.join(directory, 'source/fixtures/request-lab'),
          path.join(directory, 'app'),
          options.variant,
          path.join(options.projectRoot, 'node_modules'),
        ],
        cwd: options.projectRoot,
        transcript: path.join(directory, 'transcript.jsonl'),
        timeoutMs: 60_000,
      });

      const built = yield* listFiles(path.join(directory, 'app'));

      for (const file of built) {
        addArtifact(
          `app-${artifacts.size}`,
          `app/${file}`,
          `Executed application asset: ${file}`,
        );
      }

      const url = yield* startApplication({
        directory: path.join(directory, 'app'),
        evidenceDirectory: directory,
        ...(options.stall === undefined ? {} : { stall: options.stall }),
      });

      const browserConditions = yield* captureBrowser({
        projectRoot: options.projectRoot,
        directory,
        session: `observed-${id}`,
        url,
        addArtifact,
      });

      conditions = { kind: 'recorded', value: browserConditions };
    }).pipe(Effect.scoped, Effect.timeout(options.timeoutMs ?? 120_000));

    yield* run.pipe(
      Effect.mapError((cause) => {
        if (Cause.isTimeoutError(cause)) {
          return new CaptureFailure({
            category: 'timeout',
            message:
              'Capture timed out before the saved journey completed; see failure.txt and transcript.jsonl',
            cause,
          });
        }

        if (cause instanceof ApplicationFailure) {
          return new CaptureFailure({
            category: 'application',
            message: cause.message,
            cause,
          });
        }

        return new CaptureFailure({
          category: 'producer',
          message: cause.message,
          cause,
        });
      }),
      Effect.onExit((exit) =>
        Effect.gen(function* () {
          const finishedAt = DateTime.formatIso(yield* DateTime.now);

          if (Exit.isFailure(exit)) {
            yield* fs.writeFileString(
              path.join(directory, 'failure.txt'),
              Cause.pretty(exit.cause),
              { flag: 'wx' },
            );

            addArtifact(
              'failure',
              'failure.txt',
              'Original capture failure diagnostics',
            );
          }

          const records: CaptureArtifact[] = [];

          for (const [artifactId, artifact] of artifacts) {
            const filename = path.join(directory, artifact.path);

            if (yield* fs.exists(filename)) {
              const bytes = yield* fs.readFile(filename);

              records.push({
                id: artifactId,
                ...artifact,
                sha256: sha256(bytes),
              });
            }
          }

          let execution: Capture['execution'] = { kind: 'complete' };

          if (Exit.isFailure(exit)) {
            let reason =
              'Capture failed unexpectedly; see failure.txt and transcript.jsonl';

            let category: Extract<
              Capture['execution'],
              { kind: 'failed' }
            >['category'] = 'producer';

            if (Cause.hasInterrupts(exit.cause)) {
              category = 'cancelled';

              reason =
                'Capture was cancelled before the saved journey completed';
            } else {
              for (const failure of exit.cause.reasons) {
                if (
                  Cause.isFailReason(failure) &&
                  failure.error instanceof CaptureFailure
                ) {
                  category = failure.error.category;

                  reason = failure.error.message;
                }
              }
            }

            execution = { kind: 'failed', category, reason };
          }

          manifest = yield* Schema.decodeUnknownEffect(captureSchema)({
            schemaVersion: 2,
            kind: 'capture',
            id,
            label: options.variant,
            application: recipe.application,
            source,
            recipe: { id: recipe.id, sha256: recipeHash },
            producer,
            conditions,
            startedAt,
            finishedAt,
            execution,
            artifacts: records,
          });

          yield* fs.writeFileString(
            path.join(directory, 'capture.json'),
            json(manifest),
            { flag: 'wx' },
          );
        }),
      ),
      Effect.catchTag('CaptureFailure', () => Effect.void),
    );

    if (manifest === undefined) {
      return yield* Effect.die(
        new Error('Capture finalizer did not write a manifest'),
      );
    }

    return { directory, manifest };
  },
);
