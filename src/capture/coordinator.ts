import { Cause, DateTime, Effect, Exit, FileSystem, Schema } from 'effect';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ApplicationFailure, startApplication } from './application';
import { captureBrowser, producer } from './agent-browser';
import {
  captureSchema,
  captureSchemaVersion,
  type Capture,
  type CaptureArtifact,
} from './model';
import { processOutput } from './process';
import { observedProvenance } from './provenance';
import { json, sha256 } from '../encoding';
import { conceal } from '../redact';
import type { Project } from '../project';
import { FillValueFailure, resolveFillValues, type Recipe } from './recipe';
import { snapshotApplication } from './snapshot';

class CaptureFailure extends Schema.TaggedError<CaptureFailure>()(
  'CaptureFailure',
  {
    category: Schema.Literals([
      'timeout',
      'application',
      'configuration',
      'producer',
    ]),
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export const captureApplication = Effect.fn('captureApplication')(
  function* (options: {
    projectRoot: string;
    toolRoot: string;
    directory: string;
    project: Project;
    recipe: Recipe;
    revision: string | null;
    label: string;
    timeoutMs?: number;
  }) {
    const fs = yield* FileSystem.FileSystem;
    const directory = path.resolve(options.directory);

    yield* fs.makeDirectory(directory);

    const id = randomUUID();
    // agent-browser puts a Unix socket named after the session in a
    // per-capture directory under $TMPDIR. macOS limits the socket path to
    // 103 bytes, and that directory already takes about 65.
    const session = `obs-${id.replaceAll('-', '').slice(0, 12)}`;
    const startedAt = DateTime.formatIso(yield* DateTime.now);
    const recipe = options.recipe;
    const recipeText = json(recipe);
    const recipeHash = sha256(recipeText);

    yield* fs.writeFileString(
      path.join(directory, 'owner.json'),
      json({
        id,
        session,
        startedAt,
        processId: process.pid,
      }),
      { flag: 'wx' },
    );

    const observed = yield* observedProvenance({
      toolRoot: options.toolRoot,
      projectRoot: options.projectRoot,
      transcript: path.join(directory, 'observed-transcript.jsonl'),
    });

    const source = yield* snapshotApplication({
      projectRoot: options.projectRoot,
      directory,
      source: options.project.source,
      revision: options.revision,
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
      'project',
      'project.json',
      'Project startup and source selection',
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

    addArtifact(
      'source-transcript',
      'source-transcript.jsonl',
      'Source revision selection',
    );
    addArtifact(
      'observed-transcript',
      'observed-transcript.jsonl',
      "Observed's source commit detection",
    );
    addArtifact('application', 'application.json', 'Owned application process');
    addArtifact('application-log', 'application.log', 'Application output');

    let conditions: Capture['conditions'] = {
      kind: 'unavailable',
      reason: 'Browser conditions were not captured',
    };

    let manifest: Capture | undefined;
    let concealed: readonly string[] = [];

    const run = Effect.gen(function* () {
      yield* fs.writeFileString(
        path.join(directory, 'recipe.json'),
        recipeText,
        { flag: 'wx' },
      );
      yield* fs.writeFileString(
        path.join(directory, 'project.json'),
        json(options.project),
        { flag: 'wx' },
      );
      const fillValues = yield* resolveFillValues(recipe, process.env);
      concealed = [...fillValues.values()];
      const workspace = yield* fs.makeTempDirectoryScoped({
        prefix: 'observed-app-',
      });

      for (const file of source.files) {
        const destination = path.join(workspace, file.path);
        yield* fs.makeDirectory(path.dirname(destination), { recursive: true });
        yield* fs.copyFile(
          path.join(directory, 'source', file.path),
          destination,
        );
        yield* fs.chmod(destination, file.executable === true ? 0o755 : 0o644);
      }

      for (const [command, ...args] of options.project.setup) {
        yield* processOutput({
          command,
          args,
          cwd: workspace,
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            LANG: 'en_US.UTF-8',
            TZ: 'UTC',
          },
          transcript: path.join(directory, 'transcript.jsonl'),
          timeoutMs: options.timeoutMs ?? 120_000,
        });
      }

      const url = yield* startApplication({
        workspace,
        evidenceDirectory: directory,
        project: options.project,
        concealed,
      });

      const lockfiles = new Set([
        'bun.lock',
        'bun.lockb',
        'package-lock.json',
        'pnpm-lock.yaml',
        'yarn.lock',
        'requirements.txt',
        'Cargo.lock',
      ]);
      const dependencies = source.files.filter((file) =>
        lockfiles.has(path.posix.basename(file.path)),
      );

      const browserConditions = yield* captureBrowser({
        projectRoot: options.toolRoot,
        directory,
        session,
        url,
        addArtifact,
        recipe,
        fillValues,
        inputsHash: sha256(
          json({
            setup: options.project.setup,
            start: options.project.start,
            ready: options.project.ready,
          }),
        ),
        dependenciesHash:
          dependencies.length === 0 ? null : sha256(json(dependencies)),
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

        if (cause instanceof FillValueFailure) {
          return new CaptureFailure({
            category: 'configuration',
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
              conceal(Cause.pretty(exit.cause), concealed),
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

                  reason = conceal(failure.error.message, concealed);
                }
              }
            }

            execution = { kind: 'failed', category, reason };
          }

          manifest = yield* Schema.decodeUnknownEffect(captureSchema)({
            schemaVersion: captureSchemaVersion,
            kind: 'capture',
            id,
            label: options.label,
            application: options.project.name,
            source,
            recipe: { id: recipe.id, sha256: recipeHash },
            producer,
            observed,
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
