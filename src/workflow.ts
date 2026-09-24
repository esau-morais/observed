import { Console, Effect, FileSystem } from 'effect';
import path from 'node:path';
import { captureApplication } from './capture/coordinator';
import { processOutput } from './capture/process';
import { json } from './encoding';
import { exportComparison } from './export';
import { loadProject } from './project';

export const buildViewer = (toolRoot: string, directory: string) =>
  processOutput({
    command: process.execPath,
    args: [path.join(toolRoot, 'node_modules/vite/bin/vite.js'), 'build'],
    cwd: toolRoot,
    transcript: path.join(directory, 'viewer-build.jsonl'),
    timeoutMs: 60_000,
  });

export const runProject = Effect.fn('runProject')(function* (options: {
  projectRoot: string;
  toolRoot: string;
  directory: string;
  baseRevision: string | null;
  candidateRevision: string | null;
  timeoutMs: number;
  quiet?: boolean;
}) {
  const fs = yield* FileSystem.FileSystem;
  const { root, project, recipe } = yield* loadProject(options.projectRoot);
  const directory = path.resolve(options.directory);
  yield* fs.makeDirectory(directory, { mode: 0o700 });
  yield* fs.makeDirectory(path.join(directory, 'captures'));
  yield* fs.writeFileString(
    path.join(directory, 'project.json'),
    json(project),
    { flag: 'wx' },
  );
  const baseDirectory =
    options.baseRevision === null
      ? null
      : path.join(directory, 'captures/base');
  const candidateDirectory = path.join(directory, 'captures/candidate');

  for (const side of [
    { label: 'Base', directory: baseDirectory, revision: options.baseRevision },
    {
      label: 'Candidate',
      directory: candidateDirectory,
      revision: options.candidateRevision,
    },
  ]) {
    if (side.directory === null) {
      continue;
    }

    const captureDirectory = side.directory;

    if (options.quiet !== true) {
      yield* Console.log(`${side.label}: capturing ${project.name}`);
    }

    yield* captureApplication({
      projectRoot: root,
      toolRoot: options.toolRoot,
      directory: side.directory,
      project,
      recipe,
      revision: side.revision,
      label: side.label,
      timeoutMs: options.timeoutMs,
    }).pipe(
      Effect.catchTags({
        SourceFailure: (error) =>
          fs.writeFileString(
            path.join(captureDirectory, 'source-failure.json'),
            json({
              revision: side.revision ?? 'worktree',
              reason: error.message,
            }),
            { flag: 'wx' },
          ),
      }),
    );
  }

  yield* buildViewer(options.toolRoot, directory);

  return yield* exportComparison({
    projectRoot: options.toolRoot,
    baseDirectory,
    candidateDirectory,
    directory: path.join(directory, 'report'),
    mode: options.baseRevision === null ? 'preview' : 'comparison',
  });
});
