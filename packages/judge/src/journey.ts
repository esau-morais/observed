import { Schema } from 'effect';
import { routeSchema, text } from './capture';
import { journeyCollectors, recipeSchema, recipeSchemaVersion, stepSchema } from './recipe';
import { savedCheckSchema } from './checks';
import { collectorSchema } from './evidence';

// One journey as people write it in observed.json. Its checks are the laws a
// capture is judged by.
export const savedJourneySchema = Schema.Struct({
  name: text,
  path: routeSchema,
  ready: Schema.Array(stepSchema),
  steps: Schema.Array(stepSchema),
  check: Schema.optionalKey(savedCheckSchema),
  checks: Schema.optionalKey(Schema.Array(savedCheckSchema)),
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

export type SavedJourney = typeof savedJourneySchema.Type;

export const defaultViewport = { width: 1280, height: 800, scale: 1 };
export const defaultMaxAgeMs = 86_400_000;

export function journeyChecks({
  check,
  checks,
}: {
  check?: SavedJourney['check'] | undefined;
  checks?: SavedJourney['checks'] | undefined;
}) {
  return checks ?? (check === undefined ? [] : [check]);
}

// The recipe a capture of this journey records, with defaults applied.
export function journeyRecipe({ check, checks, collectors, ...fields }: SavedJourney) {
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
