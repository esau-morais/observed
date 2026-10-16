import type { Source } from '@observed/judge';
import { Effect, FileSystem } from 'effect';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { processOutput, type ProcessFailure } from './process';
import type { Project } from './project';
import { snapshotSource } from './snapshot';

const stderrTailLines = 3;
const stderrTailLength = 400;

function setupFailure(step: number, total: number, failure: ProcessFailure): string {
  const lines = stripVTControlCharacters(failure.stderr)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const tail = lines.slice(-stderrTailLines).join('; ');
  const quoted = tail.length > stderrTailLength ? `...${tail.slice(-stderrTailLength)}` : tail;
  const exited = `Setup step ${step} of ${total} (${failure.command}) exited with code ${failure.exitCode}`;

  return quoted === ''
    ? `${exited} and printed nothing to stderr; see transcript.jsonl`
    : `${exited}: ${quoted}`;
}

export type PreparedRevision =
  | { kind: 'source-failed'; revision: string | null; reason: string; directory: string }
  | {
      kind: 'snapshot';
      directory: string;
      source: Source;
      workspace: string;
      setup:
        { kind: 'ready' } | { kind: 'failed'; category: 'application' | 'timeout'; reason: string };
    };

export const revisionFiles = {
  source: 'source',
  sourceTranscript: 'source-transcript.jsonl',
  setupTranscript: 'setup-transcript.jsonl',
} as const;

export const prepareRevision = Effect.fn('prepareRevision')(function* (options: {
  projectRoot: string;
  project: Project;
  revision: string | null;
  timeoutMs: number;
}) {
  const fs = yield* FileSystem.FileSystem;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'observed-revision-' });
  const workspace = path.join(directory, 'workspace');
  const transcript = path.join(directory, revisionFiles.setupTranscript);

  yield* fs.writeFileString(transcript, '');
  yield* fs.writeFileString(path.join(directory, revisionFiles.sourceTranscript), '');

  const snapshot = yield* snapshotSource({
    projectRoot: options.projectRoot,
    directory,
    source: options.project.source,
    revision: options.revision,
  }).pipe(Effect.result);

  if (snapshot._tag === 'Failure') {
    return {
      kind: 'source-failed',
      revision: options.revision,
      reason: snapshot.failure.message,
      directory,
    } satisfies PreparedRevision;
  }

  const source = snapshot.success;

  for (const file of source.files) {
    const destination = path.join(workspace, file.path);
    yield* fs.makeDirectory(path.dirname(destination), { recursive: true });
    yield* fs.copyFile(path.join(directory, revisionFiles.source, file.path), destination);
    yield* fs.chmod(destination, file.executable === true ? 0o755 : 0o644);
  }

  const setup = yield* Effect.forEach(
    options.project.setup.entries(),
    ([index, [command, ...args]]) =>
      processOutput({
        command,
        args,
        cwd: workspace,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          LANG: 'en_US.UTF-8',
          TZ: 'UTC',
        },
        transcript,
        timeoutMs: options.timeoutMs,
      }).pipe(
        Effect.mapError((failure) =>
          failure._tag === 'ProcessFailure'
            ? ({
                kind: 'failed',
                category: 'application',
                reason: setupFailure(index + 1, options.project.setup.length, failure),
              } as const)
            : failure._tag === 'TimeoutError'
              ? ({
                  kind: 'failed',
                  category: 'timeout',
                  reason: `Capture timed out during setup step ${index + 1} of ${options.project.setup.length} (${command}); see transcript.jsonl`,
                } as const)
              : ({
                  kind: 'failed',
                  category: 'application',
                  reason: `Setup step ${index + 1} of ${options.project.setup.length} (${command}) could not start: ${failure.message}`,
                } as const),
        ),
      ),
    { discard: true },
  ).pipe(
    Effect.as({ kind: 'ready' } as const),
    Effect.catch((failed) => Effect.succeed(failed)),
  );

  return { kind: 'snapshot', directory, source, workspace, setup } satisfies PreparedRevision;
});
