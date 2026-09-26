import { Console, Effect, FileSystem } from 'effect';
import path from 'node:path';
import { captureApplication } from './capture/coordinator';
import { processOutput } from './capture/process';
import { json } from './encoding';
import { exportComparison } from './export';
import { loadProject } from './project';

export const buildViewer = Effect.fnUntraced(function* (
  toolRoot: string,
  transcript?: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({
    prefix: 'observed-viewer-',
  });
  const directory = path.join(root, 'viewer');

  yield* processOutput({
    command: process.execPath,
    args: [
      path.join(toolRoot, 'node_modules/vite/bin/vite.js'),
      'build',
      '--outDir',
      directory,
      '--emptyOutDir',
    ],
    cwd: toolRoot,
    transcript: transcript ?? path.join(root, 'viewer-build.jsonl'),
    timeoutMs: 60_000,
  });

  return directory;
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

  return yield* Effect.gen(function* () {
    const viewerDirectory = yield* buildViewer(
      options.toolRoot,
      path.join(directory, 'viewer-build.jsonl'),
    );

    return yield* exportComparison({
      viewerDirectory,
      baseDirectory,
      candidateDirectory,
      directory: path.join(directory, 'report'),
      mode: options.baseRevision === null ? 'preview' : 'comparison',
    });
  }).pipe(Effect.scoped);
});
