import { Effect, Schema } from 'effect';
import { httpOriginSchema, text } from './model';

const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const positive = Schema.Int.check(Schema.isGreaterThan(0));

export const routeSchema = text.check(
  Schema.makeFilter(
    (value) =>
      value.startsWith('/') &&
      !value.startsWith('//') &&
      !/[\\\p{Cc}]/u.test(value),
  ),
);

export const stepSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('navigate'), path: routeSchema }),
  Schema.Struct({ kind: Schema.Literal('click'), selector: text }),
  Schema.Struct({ kind: Schema.Literal('click-role'), role: text, name: text }),
  Schema.Struct({
    kind: Schema.Literal('fill'),
    selector: text,
    value: Schema.Union([
      Schema.String,
      Schema.Struct({
        env: text.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/)),
      }),
    ]),
  }),
  Schema.Struct({ kind: Schema.Literal('press'), key: text }),
  Schema.Struct({ kind: Schema.Literal('wait-text'), text }),
  Schema.Struct({ kind: Schema.Literal('wait-selector'), selector: text }),
  Schema.Struct({ kind: Schema.Literal('network-idle') }),
]);

const checkIdentity = { id: text, name: text, scope: text };

export const checkSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('request-count'),
    ...checkIdentity,
    method: text.check(Schema.isPattern(/^[A-Z]+$/)),
    origin: Schema.optionalKey(httpOriginSchema),
    path: routeSchema.check(
      Schema.isPattern(/^[^?#]+$/, {
        message:
          'Request checks match a pathname without query strings or fragments',
      }),
    ),
    expectedCount: count,
    status: Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 599 })),
  }),
  Schema.Struct({
    kind: Schema.Literal('text'),
    ...checkIdentity,
    selector: text,
    expectedText: Schema.String,
  }),
]);

export const recipeSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  id: text,
  name: text,
  path: routeSchema,
  ready: Schema.Array(stepSchema),
  steps: Schema.Array(stepSchema),
  check: Schema.NullOr(checkSchema),
  viewport: Schema.Struct({
    width: positive,
    height: positive,
    scale: positive,
  }),
  browserArguments: Schema.Array(text),
  allowedOrigins: Schema.optionalKey(Schema.Array(httpOriginSchema)),
  maxAgeMs: positive,
}).check(
  Schema.makeFilter(
    (recipe) =>
      recipe.check?.kind !== 'request-count' ||
      recipe.check.origin === undefined ||
      recipe.allowedOrigins?.includes(recipe.check.origin) === true,
    { message: 'Request check origin must be listed in allowedOrigins' },
  ),
);

export type Recipe = typeof recipeSchema.Type;
export type Step = typeof stepSchema.Type;
export type CheckDefinition = typeof checkSchema.Type;

export const parseRecipe = Schema.decodeUnknownEffect(
  Schema.fromJsonString(recipeSchema),
  { onExcessProperty: 'error' },
);

export class FillValueFailure extends Schema.TaggedError<FillValueFailure>()(
  'FillValueFailure',
  { message: Schema.String },
) {}

// An empty value is rejected too: CI systems commonly expand an unavailable
// secret to an empty string, and filling it would capture a different journey.
export const resolveFillValues = (
  recipe: Recipe,
  environment: Readonly<Record<string, string | undefined>>,
) => {
  const values = new Map<string, string>();
  const missing = new Set<string>();

  for (const step of [...recipe.ready, ...recipe.steps]) {
    if (step.kind !== 'fill' || typeof step.value === 'string') {
      continue;
    }

    const value = environment[step.value.env];

    if (value === undefined || value === '') {
      missing.add(step.value.env);
    } else {
      values.set(step.value.env, value);
    }
  }

  return missing.size === 0
    ? Effect.succeed(values)
    : Effect.fail(
        new FillValueFailure({
          message: `Fill value unavailable. Missing or empty environment variables: ${[...missing].join(', ')}`,
        }),
      );
};
