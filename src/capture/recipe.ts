import { Effect, Schema } from 'effect';
import { generatedBaselineChecks } from '../checks/baseline';
import { relativePathSchema } from '../project-path';
import {
  checkKinds,
  checkSchema,
  type CheckDefinition,
  type CheckKinds,
} from '../checks';
import {
  collectorSchema,
  defaultCollectors,
  type CollectorConfig,
} from '../evidence-kinds';
import { httpOriginSchema, routeSchema, text } from './model';

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

    if (
      new Set(recipe.checks.map((check) => check.id)).size !==
      recipe.checks.length
    ) {
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
      for (const kind of checkKinds[check.kind].evidence) {
        if (!collected.has(kind)) {
          issues.push(`Check ${check.id} needs a ${kind} collector`);
        }
      }

      issues.push(...checkIssues(check, recipe.collectors));
    }

    return issues;
  }),
);

function checkIssues<K extends CheckDefinition['kind']>(
  check: Extract<CheckDefinition, { kind: K }>,
  collectors: readonly CollectorConfig[],
): readonly string[] {
  const entry: CheckKinds[K] = checkKinds[check.kind];

  return entry.validate?.(check, collectors) ?? [];
}

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

    for (const collector of collectorsFor(kind, definitions)) {
      if (!collectors.some((item) => item.kind === collector.kind)) {
        collectors.push(collector);
      }
    }
  }

  // Separate sessions run in list order. Coverage goes last so its repeat of
  // the journey cannot change what an earlier session, such as the timing
  // samples, measures.
  return collectors.toSorted(
    (left, right) =>
      Number(left.kind === 'coverage') - Number(right.kind === 'coverage'),
  );
}

function collectorsFor<K extends CheckDefinition['kind']>(
  kind: K,
  definitions: readonly CheckDefinition[],
): readonly CollectorConfig[] {
  const entry: CheckKinds[K] = checkKinds[kind];

  return entry.collectors(
    definitions.filter(
      (check): check is Extract<CheckDefinition, { kind: K }> =>
        check.kind === kind,
    ),
  );
}

export type Recipe = typeof recipeSchema.Type;
export type Step = typeof stepSchema.Type;

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
