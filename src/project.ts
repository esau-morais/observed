import { Effect, FileSystem, Schema } from 'effect';
import path from 'node:path';
import { redact } from './redact';
import { routeSchema, text } from './capture/model';
import {
  journeyCollectors,
  recipeSchema,
  recipeSchemaVersion,
  stepSchema,
} from './capture/recipe';
import { checkSchema } from './checks';
import { collectorSchema } from './evidence-kinds';

export const relativePathSchema = text.check(
  Schema.makeFilter(
    (value) =>
      !path.isAbsolute(value) &&
      !/[\\:\p{Cc}]/u.test(value) &&
      value.split('/').every((part) => !['', '.', '..'].includes(part)),
  ),
);

export const commandSchema = Schema.NonEmptyArray(text);

const journeySchema = Schema.Struct({
  name: text,
  path: routeSchema,
  ready: Schema.Array(stepSchema),
  steps: Schema.Array(stepSchema),
  check: Schema.optionalKey(checkSchema),
  checks: Schema.optionalKey(Schema.Array(checkSchema)),
  collectors: Schema.optionalKey(Schema.Array(collectorSchema)),
  viewport: Schema.optionalKey(recipeSchema.fields.viewport),
  browserArguments: Schema.optionalKey(Schema.Array(text)),
  allowedOrigins: recipeSchema.fields.allowedOrigins,
  maxAgeMs: Schema.optionalKey(recipeSchema.fields.maxAgeMs),
}).check(
  Schema.makeFilter((journey) =>
    journey.check !== undefined && journey.checks !== undefined
      ? 'Set either check or checks, not both'
      : undefined,
  ),
);

export type Journey = typeof journeySchema.Type;

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
  capture: Schema.optionalKey(journeySchema),
  journeys: Schema.optionalKey(
    Schema.NonEmptyArray(journeySchema).check(Schema.isMaxLength(3)),
  ),
}).check(
  Schema.makeFilter((project) => {
    if ((project.capture === undefined) === (project.journeys === undefined)) {
      return 'Set either capture, for one journey, or journeys, for one to three';
    }

    const names = (project.journeys ?? []).map((journey) => journey.name);

    return new Set(names).size === names.length
      ? undefined
      : 'Journey names must be unique';
  }),
);

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
      message: `No observed.json in ${root}. Ask your agent to configure this application's startup and the page to capture. See https://github.com/esau-morais/observed#write-observedjson for the fields.`,
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
    errors: 'all',
  })(input).pipe(
    Effect.mapError(
      (error) =>
        new ProjectFailure({
          message: `${filename} does not match the project contract:\n${error.message}`,
        }),
    ),
  );

  const journeys = project.journeys ?? [
    project.capture ?? (yield* Effect.die('Project has no journey')),
  ];
  const recipes = yield* Effect.forEach(journeys, (journey) =>
    Schema.decodeUnknownEffect(recipeSchema)(journeyRecipe(journey)).pipe(
      Effect.mapError(
        (error) =>
          new ProjectFailure({
            message: `${filename}: journey ${JSON.stringify(journey.name)} is inconsistent:\n${error.message}`,
          }),
      ),
    ),
  );
  const [first, ...rest] = recipes;

  if (first === undefined) {
    return yield* Effect.die('Project has no journey');
  }

  return { root, project, recipes: [first, ...rest] as const };
});

function journeyRecipe({ check, checks, collectors, ...journey }: Journey) {
  const configured = checks ?? (check === undefined ? [] : [check]);

  return {
    schemaVersion: recipeSchemaVersion,
    id: journey.name,
    ...journey,
    checks: configured,
    collectors: journeyCollectors(configured, collectors ?? []),
    viewport: journey.viewport ?? { width: 1280, height: 800, scale: 1 },
    browserArguments: journey.browserArguments ?? [],
    maxAgeMs: journey.maxAgeMs ?? 86_400_000,
  };
}
