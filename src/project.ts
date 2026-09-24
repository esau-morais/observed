import { Effect, FileSystem, Schema } from 'effect';
import path from 'node:path';
import { redact } from './redact';
import { text } from './capture/model';
import {
  checkSchema,
  recipeSchema,
  routeSchema,
  stepSchema,
} from './capture/recipe';

export const relativePathSchema = text.check(
  Schema.makeFilter(
    (value) =>
      !path.isAbsolute(value) &&
      !/[\\:\p{Cc}]/u.test(value) &&
      value.split('/').every((part) => !['', '.', '..'].includes(part)),
  ),
);

export const commandSchema = Schema.NonEmptyArray(text);

export const projectSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  name: text,
  source: Schema.Struct({
    entry: relativePathSchema,
    paths: Schema.NonEmptyArray(relativePathSchema),
  }),
  setup: Schema.Array(commandSchema),
  start: commandSchema,
  ready: Schema.Struct({
    path: routeSchema,
    status: Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 599 })),
  }),
  capture: Schema.Struct({
    name: text,
    path: routeSchema,
    ready: Schema.Array(stepSchema),
    steps: Schema.Array(stepSchema),
    check: Schema.optionalKey(checkSchema),
    viewport: Schema.optionalKey(recipeSchema.fields.viewport),
    browserArguments: Schema.optionalKey(Schema.Array(text)),
    maxAgeMs: Schema.optionalKey(recipeSchema.fields.maxAgeMs),
  }),
});

export type Project = typeof projectSchema.Type;

export class ProjectFailure extends Schema.TaggedError<ProjectFailure>()(
  'ProjectFailure',
  { message: Schema.String },
) {}

export const loadProject = Effect.fn('loadProject')(function* (
  directory: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.realPath(directory);
  const filename = path.join(root, 'observed.json');

  if (!(yield* fs.exists(filename))) {
    return yield* new ProjectFailure({
      message: `No observed.json in ${root}. Ask your agent to configure this application's startup and the page to capture. See src/project.ts for the configuration contract.`,
    });
  }

  const input = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(Schema.Unknown),
  )(yield* fs.readFileString(filename)).pipe(
    Effect.mapError(
      () =>
        new ProjectFailure({
          message: 'observed.json must contain valid JSON',
        }),
    ),
  );

  if (JSON.stringify(redact(input)) !== JSON.stringify(input)) {
    return yield* new ProjectFailure({
      message:
        'observed.json contains credentials. Use disposable inputs without credentials for exported captures.',
    });
  }

  const project = yield* Schema.decodeUnknownEffect(projectSchema, {
    onExcessProperty: 'error',
  })(input);

  const recipe = yield* Schema.decodeUnknownEffect(recipeSchema)({
    schemaVersion: 1,
    id: project.capture.name,
    ...project.capture,
    check: project.capture.check ?? null,
    viewport: project.capture.viewport ?? {
      width: 1280,
      height: 800,
      scale: 1,
    },
    browserArguments: project.capture.browserArguments ?? [],
    maxAgeMs: project.capture.maxAgeMs ?? 86_400_000,
  });

  return { root, project, recipe };
});
