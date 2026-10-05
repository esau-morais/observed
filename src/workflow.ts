import { Console, Effect, FileSystem } from 'effect';
import path from 'node:path';
import { gitChanges } from './capture/changed-files';
import { captureApplication } from './capture/coordinator';
import { processOutput } from './capture/process';
import { json } from './encoding';
import { exportComparison } from './export';
import { packaged } from './installation';
import { readBaseJourneys } from './capture/base-project';
import { loadProject } from './project';
import { loadGeneratedJourneys } from './generated-journeys';

export const buildViewer = Effect.fnUntraced(function* (
  toolRoot: string,
  transcript?: string,
) {
  if (packaged !== null) {
    return path.join(toolRoot, 'dist/viewer');
  }

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
  generatedFile?: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const {
    root,
    project,
    journeys: defined,
    recipes: savedRecipes,
  } = yield* loadProject(options.projectRoot);
  const directory = path.resolve(options.directory);
  yield* fs.makeDirectory(directory, { mode: 0o700 });
  // Both sides ran the candidate's journeys; the base's file judges them.
  const sources =
    options.baseRevision === null
      ? undefined
      : {
          base: yield* readBaseJourneys({
            projectRoot: root,
            baseRevision: options.baseRevision,
            transcript: path.join(directory, 'base-project-transcript.jsonl'),
          }),
          candidate: defined,
        };

  const knownJourneys = [
    ...defined,
    ...(sources?.base.kind === 'read'
      ? sources.base.journeys.filter(
          (journey) => !defined.some((saved) => saved.name === journey.name),
        )
      : []),
  ];
  const generated =
    options.generatedFile === undefined
      ? null
      : yield* loadGeneratedJourneys(options.generatedFile, knownJourneys);
  const recipes = [...savedRecipes, ...(generated?.recipes ?? [])];
  yield* fs.makeDirectory(path.join(directory, 'captures'));

  if (generated !== null) {
    yield* fs.writeFileString(
      path.join(directory, 'generated.json'),
      json(generated.proposal),
      { flag: 'wx' },
    );
  }

  yield* fs.writeFileString(
    path.join(directory, 'project.json'),
    json(project),
    { flag: 'wx' },
  );

  const journeys = yield* Effect.forEach(recipes, (recipe, index) =>
    Effect.gen(function* () {
      const journeyDirectory = path.join(
        directory,
        'captures',
        `journey-${index + 1}`,
      );
      const baseDirectory =
        options.baseRevision === null
          ? null
          : path.join(journeyDirectory, 'base');
      const candidateDirectory = path.join(journeyDirectory, 'candidate');

      yield* fs.makeDirectory(journeyDirectory);

      for (const side of [
        {
          label: 'Base',
          directory: baseDirectory,
          revision: options.baseRevision,
        },
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
          yield* Console.log(
            recipes.length === 1
              ? `${side.label}: capturing ${project.name}`
              : `${side.label}: capturing ${project.name}, ${recipe.name}`,
          );
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

      return {
        baseDirectory,
        candidateDirectory,
        ...(recipe.generated === undefined
          ? {}
          : { generated: { name: recipe.name, ...recipe.generated } }),
      };
    }),
  );
  const [first, ...rest] = journeys;

  if (first === undefined) {
    return yield* Effect.die('A project has at least one journey');
  }

  const changes =
    options.baseRevision === null
      ? undefined
      : yield* gitChanges({
          projectRoot: root,
          baseRevision: options.baseRevision,
          candidateRevision: options.candidateRevision,
          transcript: path.join(directory, 'changes-transcript.jsonl'),
        });

  return yield* Effect.gen(function* () {
    const viewerDirectory = yield* buildViewer(
      options.toolRoot,
      path.join(directory, 'viewer-build.jsonl'),
    );

    return yield* exportComparison({
      viewerDirectory,
      journeys: [first, ...rest],
      directory: path.join(directory, 'report'),
      mode: options.baseRevision === null ? 'preview' : 'comparison',
      ...(changes === undefined ? {} : { changes }),
      ...(sources === undefined ? {} : { recipes: sources }),
    });
  }).pipe(Effect.scoped);
});
