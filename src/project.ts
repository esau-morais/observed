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

export const journeySchema = Schema.Struct({
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
  {
    message: Schema.String,
    problem: Schema.optionalKey(
      Schema.Literals(['json', 'credentials', 'contract', 'journey']),
    ),
  },
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

  const { project, journeys, recipes } = yield* parseProject(
    yield* fs.readFileString(filename),
    filename,
  );

  return { root, project, journeys, recipes };
});

export const parseProject = Effect.fnUntraced(function* (
  content: string,
  filename: string,
) {
  const input = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(Schema.Unknown),
  )(content).pipe(
    Effect.mapError(
      () =>
        new ProjectFailure({
          message: 'observed.json must contain valid JSON',
          problem: 'json',
        }),
    ),
  );

  if (JSON.stringify(redact(input)) !== JSON.stringify(input)) {
    return yield* new ProjectFailure({
      message:
        'observed.json contains credentials. Use disposable inputs without credentials for exported captures.',
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

  const [firstJourney, ...otherJourneys] = project.journeys ?? [
    project.capture ?? (yield* Effect.die('Project has no journey')),
  ];

  if (firstJourney === undefined) {
    return yield* Effect.die('Project has no journey');
  }

  const journeys = [firstJourney, ...otherJourneys] as const;
  const recipes = yield* Effect.forEach(journeys, (journey) =>
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
  const [first, ...rest] = recipes;

  if (first === undefined) {
    return yield* Effect.die('Project has no journey');
  }

  return { project, journeys, recipes: [first, ...rest] as const };
});

export const defaultViewport = { width: 1280, height: 800, scale: 1 };
export const defaultMaxAgeMs = 86_400_000;

export function journeyChecks({
  check,
  checks,
}: {
  check?: Journey['check'] | undefined;
  checks?: Journey['checks'] | undefined;
}) {
  return checks ?? (check === undefined ? [] : [check]);
}

function journeyRecipe({ check, checks, collectors, ...fields }: Journey) {
  const configured = journeyChecks({ check, checks });

  return {
    schemaVersion: recipeSchemaVersion,
    id: fields.name,
    ...fields,
    checks: configured,
    collectors: journeyCollectors(configured, collectors ?? []),
    viewport: fields.viewport ?? defaultViewport,
    browserArguments: fields.browserArguments ?? [],
    maxAgeMs: fields.maxAgeMs ?? defaultMaxAgeMs,
  };
}
