import { Effect, FileSystem, Schema } from 'effect';
import {
  generatedOriginSchema,
  journeyCollectors,
  recipeSchema,
  stepSchema,
} from './capture/recipe';
import { routeSchema, text } from './capture/model';
import { generatedBaselineChecks } from './checks/baseline';
import { journeyRecipe, ProjectFailure, type Journey } from './project';
import { redact } from './redact';

export const generatedJourneyLimit = 3;

const steps = Schema.Array(stepSchema).check(Schema.isMaxLength(20));

export const generatedJourneysSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  journeys: Schema.NonEmptyArray(
    Schema.Struct({
      name: text,
      path: routeSchema,
      ready: steps,
      steps,
      ...generatedOriginSchema.fields,
      textSelectors: Schema.optionalKey(
        Schema.NonEmptyArray(text).check(
          Schema.isUnique(),
          Schema.isMaxLength(10),
        ),
      ),
    }),
  ).check(Schema.isMaxLength(generatedJourneyLimit)),
});

export const parseGeneratedJourneys = Effect.fnUntraced(function* (
  content: string,
  saved: readonly Journey[],
) {
  const input = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(Schema.Unknown),
  )(content).pipe(
    Effect.mapError(
      () =>
        new ProjectFailure({
          message: 'Generated journeys must contain valid JSON',
        }),
    ),
  );
  if (JSON.stringify(redact(input)) !== JSON.stringify(input)) {
    return yield* new ProjectFailure({
      message:
        'Generated journeys contain credentials. Use disposable inputs without credentials.',
    });
  }

  const proposal = yield* Schema.decodeUnknownEffect(generatedJourneysSchema, {
    onExcessProperty: 'error',
    errors: 'all',
  })(input).pipe(
    Effect.mapError(
      (error) =>
        new ProjectFailure({
          message: `Generated journeys do not match the contract:\n${error.message}`,
        }),
    ),
  );
  const names = [...saved, ...proposal.journeys].map((journey) => journey.name);
  if (new Set(names).size !== names.length) {
    return yield* new ProjectFailure({
      message:
        'Generated journey names must be unique and cannot replace a saved journey',
    });
  }

  const environment = saved[0];
  const recipes = yield* Effect.forEach(
    proposal.journeys,
    ({ targets, reason, textSelectors, ...journey }) =>
      Schema.decodeUnknownEffect(recipeSchema)({
        ...journeyRecipe({
          ...journey,
          ...(environment?.viewport === undefined
            ? {}
            : { viewport: environment.viewport }),
          ...(environment?.browserArguments === undefined
            ? {}
            : { browserArguments: environment.browserArguments }),
          ...(environment?.allowedOrigins === undefined
            ? {}
            : { allowedOrigins: environment.allowedOrigins }),
          ...(environment?.maxAgeMs === undefined
            ? {}
            : { maxAgeMs: environment.maxAgeMs }),
        }),
        checks: generatedBaselineChecks,
        collectors: journeyCollectors(
          generatedBaselineChecks,
          textSelectors === undefined
            ? []
            : [{ kind: 'text', selectors: textSelectors }],
        ),
        generated: { targets, reason },
      }).pipe(
        Effect.mapError(
          (error) =>
            new ProjectFailure({
              message: `Generated journey is inconsistent:\n${error.message}`,
            }),
        ),
      ),
  );

  return { proposal, recipes };
});

export const loadGeneratedJourneys = Effect.fnUntraced(function* (
  filename: string,
  saved: readonly Journey[],
) {
  const fs = yield* FileSystem.FileSystem;

  return yield* parseGeneratedJourneys(
    yield* fs.readFileString(filename),
    saved,
  );
});
