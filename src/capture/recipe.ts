import { Schema } from 'effect';
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
    value: Schema.String,
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
