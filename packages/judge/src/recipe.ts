import { Schema } from 'effect';
import { generatedBaselineChecks } from './checks/baseline';
import { checkKind, checkSchema, type CheckDefinition } from './checks';
import { collectorSchema, defaultCollectors, type CollectorConfig } from './evidence';
import { httpOriginSchema, relativePathSchema, routeSchema, text } from './capture';

const positive = Schema.Int.check(Schema.isGreaterThan(0));

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

export const recipeSchemaVersion = 2;

export const generatedOriginSchema = Schema.Struct({
  targets: Schema.NonEmptyArray(relativePathSchema).check(Schema.isUnique()),
  reason: text,
});

export const recipeSchema = Schema.Struct({
  schemaVersion: Schema.Literal(recipeSchemaVersion),
  id: text,
  generated: Schema.optionalKey(generatedOriginSchema),
  name: text,
  path: routeSchema,
  ready: Schema.Array(stepSchema),
  steps: Schema.Array(stepSchema),
  checks: Schema.Array(checkSchema),
  collectors: Schema.Array(collectorSchema),
  viewport: Schema.Struct({
    width: positive,
    height: positive,
    scale: positive,
  }),
  browserArguments: Schema.Array(text),
  allowedOrigins: Schema.optionalKey(Schema.Array(httpOriginSchema)),
  maxAgeMs: positive,
}).check(
  Schema.makeFilter((recipe) => {
    const issues: Schema.FilterIssue[] = [];
    if (
      recipe.generated !== undefined &&
      !(
        recipe.checks.length === generatedBaselineChecks.length &&
        recipe.checks.every((check, index) => {
          const fixed = generatedBaselineChecks[index];

          return (
            fixed !== undefined &&
            check.kind === fixed.kind &&
            check.id === fixed.id &&
            check.name === fixed.name &&
            check.scope === fixed.scope &&
            (check.kind !== 'accessibility' || check.impact === 'serious')
          );
        })
      )
    ) {
      issues.push('Generated journeys carry only the fixed baseline checks');
    }

    const collected = new Set(recipe.collectors.map((item) => item.kind));

    if (new Set(recipe.checks.map((check) => check.id)).size !== recipe.checks.length) {
      issues.push('Check IDs must be unique within a journey');
    }

    if (collected.size !== recipe.collectors.length) {
      issues.push('A journey lists at most one collector of each kind');
    }

    if (
      recipe.checks.some(
        (check) =>
          check.kind === 'request-count' &&
          check.origin !== undefined &&
          recipe.allowedOrigins?.includes(check.origin) !== true,
      )
    ) {
      issues.push('Request check origin must be listed in allowedOrigins');
    }

    for (const check of recipe.checks) {
      for (const kind of checkKind(check).evidence) {
        if (!collected.has(kind)) {
          issues.push(`Check ${check.id} needs a ${kind} collector`);
        }
      }

      issues.push(...(checkKind(check).validate?.(check, recipe.collectors) ?? []));
    }

    return issues;
  }),
);

// Adds the default collectors and the collectors checks need, unless the
// journey already lists that kind.
export function journeyCollectors(
  checks: readonly CheckDefinition[],
  listed: readonly CollectorConfig[],
): CollectorConfig[] {
  const collectors = [
    ...listed,
    ...defaultCollectors.filter(
      (collector) => !listed.some((item) => item.kind === collector.kind),
    ),
  ];

  for (const kind of new Set(checks.map((check) => check.kind))) {
    const definitions = checks.filter((check) => check.kind === kind);
    const [first] = definitions;

    if (first === undefined) {
      continue;
    }

    for (const collector of checkKind(first).collectors(definitions)) {
      if (!collectors.some((item) => item.kind === collector.kind)) {
        collectors.push(collector);
      }
    }
  }

  // Separate sessions run in list order. Coverage goes last so its repeat of
  // the journey cannot change what an earlier session, such as the timing
  // samples, measures.
  return collectors.toSorted(
    (left, right) => Number(left.kind === 'coverage') - Number(right.kind === 'coverage'),
  );
}

export type Recipe = typeof recipeSchema.Type;
export type Step = typeof stepSchema.Type;

export const parseRecipe = Schema.decodeUnknownEffect(Schema.fromJsonString(recipeSchema), {
  onExcessProperty: 'error',
});
