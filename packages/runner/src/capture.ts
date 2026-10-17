import {
  captureSchema,
  captureSchemaVersion,
  json,
  sha256,
  type Capture,
  type CaptureArtifact,
  type Observed,
  type Recipe,
} from '@observed/judge';
import { Cause, DateTime, Effect, Exit, FileSystem, Schema } from 'effect';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Browser } from 'playwright';
import playwrightPackage from 'playwright/package.json' with { type: 'json' };
import { startApplication } from './application';
import { captureBrowser, type PendingEvidence } from './browser';
import type { NewArtifact } from './collectors/define';
import { apiEnvironment } from './collectors/api';
import type { Project } from './project';
import { conceal } from './redact';
import { revisionFiles, type PreparedRevision } from './revision';

export const producer = { name: 'playwright', version: playwrightPackage.version } as const;

export class CaptureFailure extends Schema.TaggedError<CaptureFailure>()('CaptureFailure', {
  category: Schema.Literals(['timeout', 'application', 'configuration', 'producer']),
  message: Schema.String,
}) {}

const lockfiles = new Set([
  'bun.lock',
  'bun.lockb',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'requirements.txt',
  'Cargo.lock',
]);

// An empty value is rejected too: CI systems commonly expand an unavailable
// secret to an empty string, and using it would capture a different journey.
export function environmentValues(names: readonly string[], what: string) {
  const values = new Map<string, string>();
  const missing = new Set<string>();

  for (const name of names) {
    const value = process.env[name];

    if (value === undefined || value === '') {
      missing.add(name);
    } else {
      values.set(name, value);
    }
  }

  return missing.size === 0
    ? Effect.succeed(values)
    : Effect.fail(
        new CaptureFailure({
          category: 'configuration',
          message: `${what} unavailable. Missing or empty environment variables: ${[...missing].join(', ')}`,
        }),
      );
}

const fillNames = (recipe: Recipe) =>
  [...recipe.ready, ...recipe.steps].flatMap((step) =>
    step.kind === 'fill' && typeof step.value !== 'string' ? [step.value.env] : [],
  );

export const collectorNames = (recipe: Recipe) =>
  recipe.collectors.flatMap((collector) => {
    switch (collector.kind) {
      case 'api':
        return apiEnvironment(collector.operations);
      case 'playwright':
        return collector.environment ?? [];
      default:
        return [];
    }
  });

export const captureJourney = Effect.fn('captureJourney')(function* (options: {
  directory: string;
  revision: Extract<PreparedRevision, { kind: 'snapshot' }>;
  project: Project;
  recipe: Recipe;
  browser: Effect.Effect<Browser, CaptureFailure>;
  observed: Observed;
  label: string;
  timeoutMs: number;
}) {
  const fs = yield* FileSystem.FileSystem;
  const { directory, recipe, revision, project } = options;
  const id = randomUUID();
  const startedAt = DateTime.formatIso(yield* DateTime.now);
  const recipeText = json(recipe);
  const artifacts = new Map<string, { path: string; description: string }>();
  const pendingEvidence: PendingEvidence[] = [];
  const addArtifact = ({ id: artifactId, ...artifact }: NewArtifact) => {
    artifacts.set(artifactId, artifact);
  };

  yield* fs.makeDirectory(directory);

  for (const [index, file] of revision.source.files.entries()) {
    const destination = path.join(directory, 'source', file.path);
    yield* fs.makeDirectory(path.dirname(destination), { recursive: true });
    yield* fs.copyFile(path.join(revision.directory, revisionFiles.source, file.path), destination);
    addArtifact({
      id: `source-${index}`,
      path: `source/${file.path}`,
      description: `Source snapshot: ${file.path}`,
    });
  }

  yield* fs.copyFile(
    path.join(revision.directory, revisionFiles.sourceTranscript),
    path.join(directory, 'source-transcript.jsonl'),
  );
  yield* fs.copyFile(
    path.join(revision.directory, revisionFiles.setupTranscript),
    path.join(directory, 'transcript.jsonl'),
  );
  yield* fs.writeFileString(path.join(directory, 'recipe.json'), recipeText, { flag: 'wx' });
  yield* fs.writeFileString(path.join(directory, 'project.json'), json(project), { flag: 'wx' });
  addArtifact({
    id: 'source-transcript',
    path: 'source-transcript.jsonl',
    description: 'Source revision selection',
  });
  addArtifact({
    id: 'transcript',
    path: 'transcript.jsonl',
    description: "Setup command output; setup ran once for this revision's journeys",
  });
  addArtifact({
    id: 'recipe',
    path: 'recipe.json',
    description: 'Protected saved journey and expectation',
  });
  addArtifact({
    id: 'project',
    path: 'project.json',
    description: 'Project startup and source selection',
  });
  addArtifact({
    id: 'application',
    path: 'application.json',
    description: 'Owned application process',
  });
  addArtifact({
    id: 'application-log',
    path: 'application.log',
    description: 'Application output',
  });
  addArtifact({
    id: 'server-cleanup',
    path: 'server-cleanup.json',
    description: 'Owned application shutdown',
  });

  let conditions: Capture['conditions'] = {
    kind: 'unavailable',
    reason: 'Browser conditions were not captured',
  };
  let concealed: readonly string[] = [];
  const dependencies = revision.source.files.filter((file) =>
    lockfiles.has(path.posix.basename(file.path)),
  );

  const run = Effect.gen(function* () {
    if (revision.setup.kind === 'failed') {
      return yield* new CaptureFailure({
        category: revision.setup.category,
        message: revision.setup.reason,
      });
    }

    const values = yield* environmentValues(fillNames(recipe), 'Fill value');
    const collectorValues = yield* environmentValues(
      collectorNames(recipe),
      'Collector environment value',
    );
    concealed = [...values.values(), ...collectorValues.values()];
    const url = yield* startApplication({
      workspace: revision.workspace,
      evidenceDirectory: directory,
      project,
      concealed,
    });
    const browser = yield* options.browser;

    conditions = {
      kind: 'recorded',
      value: yield* captureBrowser({
        browser,
        directory,
        url,
        recipe,
        fillValues: values,
        collectorValues,
        workspace: revision.workspace,
        timeoutMs: options.timeoutMs,
        addArtifact,
        addEvidence: (entry) => {
          pendingEvidence.push(entry);
        },
        inputsHash: sha256(
          json({ setup: project.setup, start: project.start, ready: project.ready }),
        ),
        dependenciesHash: dependencies.length === 0 ? null : sha256(json(dependencies)),
      }),
    };
  }).pipe(Effect.scoped, Effect.timeout(options.timeoutMs));

  let manifest: Capture | undefined;

  yield* run.pipe(
    Effect.mapError((cause) => {
      if (Cause.isTimeoutError(cause)) {
        return new CaptureFailure({
          category: 'timeout',
          message: 'Capture timed out before the saved journey completed; see failure.txt',
        });
      }

      switch (cause._tag) {
        case 'CaptureFailure':
          return cause;
        case 'ApplicationFailure':
          return new CaptureFailure({ category: 'application', message: cause.message });
        case 'BrowserFailure':
          return new CaptureFailure({ category: cause.category, message: cause.message });
        default:
          return new CaptureFailure({ category: 'producer', message: cause.message });
      }
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
          addArtifact({
            id: 'failure',
            path: 'failure.txt',
            description: 'Original capture failure diagnostics',
          });
        }

        const records: CaptureArtifact[] = [];

        for (const [artifactId, artifact] of artifacts) {
          const filename = path.join(directory, artifact.path);

          if (yield* fs.exists(filename)) {
            records.push({
              id: artifactId,
              ...artifact,
              sha256: sha256(yield* fs.readFile(filename)),
            });
          }
        }

        const evidence = pendingEvidence.map((entry): Capture['evidence'][number] => {
          if (entry.status === 'unavailable') {
            return { producer, ...entry };
          }

          const written = records.find((item) => item.path === entry.path);

          return written === undefined
            ? {
                kind: entry.kind,
                schemaVersion: entry.schemaVersion,
                status: 'unavailable',
                reason: `Evidence file ${entry.path} was not written`,
                producer: entry.producer ?? producer,
              }
            : { producer, ...entry, sha256: written.sha256 };
        });

        let execution: Capture['execution'] = { kind: 'complete' };

        if (Exit.isFailure(exit)) {
          const failure = exit.cause.reasons.find(Cause.isFailReason)?.error;

          execution = Cause.hasInterrupts(exit.cause)
            ? {
                kind: 'failed',
                category: 'cancelled',
                reason: 'Capture was cancelled before the saved journey completed',
              }
            : {
                kind: 'failed',
                category: failure?.category ?? 'producer',
                reason: conceal(
                  failure?.message ?? 'Capture failed unexpectedly; see failure.txt',
                  concealed,
                ),
              };
        }

        manifest = yield* Schema.decodeUnknownEffect(captureSchema)({
          schemaVersion: captureSchemaVersion,
          kind: 'capture',
          id,
          label: options.label,
          application: project.name,
          source: revision.source,
          recipe: { id: recipe.id, sha256: sha256(recipeText) },
          producer,
          observed: options.observed,
          conditions,
          startedAt,
          finishedAt,
          execution,
          artifacts: records,
          evidence,
        });

        yield* fs.writeFileString(path.join(directory, 'capture.json'), json(manifest), {
          flag: 'wx',
        });
      }).pipe(Effect.orDie),
    ),
    Effect.catchTag('CaptureFailure', () => Effect.void),
  );

  if (manifest === undefined) {
    return yield* Effect.die('The capture finalizer did not write a manifest');
  }

  return manifest;
});
