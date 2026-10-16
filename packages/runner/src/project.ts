import {
  commitSchema,
  journeyRecipe,
  recipeSchema,
  relativePathSchema,
  routeSchema,
  savedJourneySchema,
  sha256,
  text,
  type RecipeSources,
} from '@observed/judge';
import { Effect, FileSystem, Schema } from 'effect';
import path from 'node:path';
import { gitEnvironment, processOutput } from './process';
import { redact } from './redact';

const commandSchema = Schema.NonEmptyArray(text);

export const projectSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  name: text,
  source: Schema.Struct({
    entry: relativePathSchema,
    paths: Schema.NonEmptyArray(relativePathSchema),
  }),
  setup: Schema.Array(commandSchema),
  // `{port}` in an argument becomes the port the app must listen on.
  start: commandSchema,
  ready: Schema.Struct({
    path: routeSchema,
    status: Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 599 })),
  }),
  capture: Schema.optionalKey(savedJourneySchema),
  journeys: Schema.optionalKey(
    Schema.NonEmptyArray(savedJourneySchema).check(Schema.isMaxLength(3)),
  ),
}).check(
  Schema.makeFilter((project) => {
    if ((project.capture === undefined) === (project.journeys === undefined)) {
      return 'Set either capture, for one journey, or journeys, for one to three';
    }

    const names = (project.journeys ?? []).map((journey) => journey.name);

    return new Set(names).size === names.length ? undefined : 'Journey names must be unique';
  }),
);

export type Project = typeof projectSchema.Type;

export class ProjectFailure extends Schema.TaggedError<ProjectFailure>()('ProjectFailure', {
  message: Schema.String,
  problem: Schema.Literals(['json', 'credentials', 'contract', 'journey']),
}) {}

export class ProjectUnreadable extends Schema.TaggedError<ProjectUnreadable>()(
  'ProjectUnreadable',
  { message: Schema.String },
) {}

export const parseProject = Effect.fnUntraced(function* ({
  content,
  filename,
}: {
  content: string;
  filename: string;
}) {
  const input = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(
    content,
  ).pipe(
    Effect.mapError(
      () => new ProjectFailure({ message: `${filename} must contain valid JSON`, problem: 'json' }),
    ),
  );

  if (JSON.stringify(redact(input)) !== JSON.stringify(input)) {
    return yield* new ProjectFailure({
      message: `${filename} contains credentials. Read them from the environment instead.`,
      problem: 'credentials',
    });
  }

  const project = yield* Schema.decodeUnknownEffect(projectSchema, {
    onExcessProperty: 'error',
    errors: 'all',
  })(input).pipe(
    Effect.mapError(
      (error) =>
        new ProjectFailure({
          message: `${filename} does not match the project contract:\n${error.message}`,
          problem: 'contract',
        }),
    ),
  );
  const journeys = project.journeys ?? (project.capture === undefined ? [] : [project.capture]);
  const [first, ...rest] = journeys;

  if (first === undefined) {
    return yield* Effect.die('A parsed project has at least one journey');
  }

  const recipes = yield* Effect.forEach([first, ...rest], (journey) =>
    Schema.decodeUnknownEffect(recipeSchema)(journeyRecipe(journey)).pipe(
      Effect.mapError(
        (error) =>
          new ProjectFailure({
            message: `${filename}: journey ${JSON.stringify(journey.name)} is inconsistent:\n${error.message}`,
            problem: 'journey',
          }),
      ),
    ),
  );
  return {
    project,
    journeys: [first, ...rest] as const,
    recipes,
  };
});

export const loadProject = Effect.fn('loadProject')(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.realPath(directory);
  const filename = path.join(root, 'observed.json');

  if (!(yield* fs.exists(filename))) {
    return yield* new ProjectUnreadable({ message: `No observed.json in ${root}` });
  }

  return {
    root,
    ...(yield* parseProject({ content: yield* fs.readFileString(filename), filename })),
  };
});

const baseProblems = {
  json: "The base revision's observed.json is not valid JSON.",
  credentials: "The base revision's observed.json contains credentials.",
  contract: "The base revision's observed.json does not match the project contract.",
  journey: "The base revision's observed.json has an inconsistent journey.",
} as const;

const firstLine = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '');

const observedJsonAt = Effect.fnUntraced(function* (options: {
  projectRoot: string;
  revision: string;
  transcript: string;
}) {
  const git = (args: readonly string[]) =>
    processOutput({
      command: 'git',
      args,
      cwd: options.projectRoot,
      env: gitEnvironment(),
      transcript: options.transcript,
    });
  const commit = yield* Schema.decodeUnknownEffect(commitSchema)(
    (yield* git([
      'rev-parse',
      '--verify',
      '--end-of-options',
      `${options.revision}^{commit}`,
    ])).trim(),
  );
  const prefix = (yield* git(['rev-parse', '--show-prefix'])).trim();
  const file = `${prefix}observed.json`;
  const listed = yield* git(['ls-tree', '--full-tree', '--name-only', commit, '--', file]);

  return {
    commit,
    content: listed.trim() === '' ? null : yield* git(['cat-file', 'blob', `${commit}:${file}`]),
  };
});

export const loadProjectAt = Effect.fn('loadProjectAt')(function* (options: {
  projectRoot: string;
  revision: string;
  transcript: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.realPath(options.projectRoot);
  const { commit, content } = yield* observedJsonAt({ ...options, projectRoot: root }).pipe(
    Effect.mapError(
      (error) =>
        new ProjectUnreadable({
          message: `Git could not read observed.json from ${options.revision}: ${error._tag === 'ProcessFailure' ? (firstLine(error.stderr) ?? error.message) : error.message}`,
        }),
    ),
  );

  if (content === null) {
    return yield* new ProjectUnreadable({ message: `${commit} has no observed.json` });
  }

  return { root, ...(yield* parseProject({ content, filename: `observed.json at ${commit}` })) };
});

export const readBaseJourneys = Effect.fn('readBaseJourneys')(
  function* (options: { projectRoot: string; baseRevision: string; transcript: string }) {
    const { commit, content } = yield* observedJsonAt({
      projectRoot: options.projectRoot,
      revision: options.baseRevision,
      transcript: options.transcript,
    });

    if (content === null) {
      return {
        kind: 'unusable',
        commit,
        reason: 'The base revision has no observed.json.',
      } satisfies RecipeSources['base'];
    }

    return yield* parseProject({ content, filename: 'observed.json' }).pipe(
      Effect.map(({ journeys }): RecipeSources['base'] => ({
        kind: 'read',
        commit,
        sha256: sha256(content),
        journeys,
      })),
      Effect.catchTag('ProjectFailure', (error) =>
        Effect.succeed<RecipeSources['base']>({
          kind: 'unusable',
          commit,
          reason: baseProblems[error.problem],
        }),
      ),
    );
  },
  Effect.catchTags({
    ProcessFailure: (error) =>
      Effect.succeed<RecipeSources['base']>({
        kind: 'unavailable',
        reason: `Git could not read observed.json from the base revision: ${firstLine(error.stderr) ?? error.message}`,
      }),
    PlatformError: (error) =>
      Effect.succeed<RecipeSources['base']>({
        kind: 'unavailable',
        reason: `Git could not read observed.json from the base revision: ${error.message}`,
      }),
    SchemaError: () =>
      Effect.succeed<RecipeSources['base']>({
        kind: 'unavailable',
        reason: 'Git returned a base revision that is not a commit ID.',
      }),
    TimeoutError: () =>
      Effect.succeed<RecipeSources['base']>({
        kind: 'unavailable',
        reason: 'Git did not answer within 30 seconds.',
      }),
  }),
);
