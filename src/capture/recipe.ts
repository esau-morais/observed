import { Effect, Schema } from 'effect';
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

export const recipeSchema = Schema.Struct({
  schemaVersion: Schema.Literal(recipeSchemaVersion),
  id: text,
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

// Adds the collectors checks need, unless the journey already lists that kind.
export function journeyCollectors(
  checks: readonly CheckDefinition[],
  listed: readonly CollectorConfig[],
): CollectorConfig[] {
  const collectors = [...listed, ...defaultCollectors];

  for (const kind of new Set(checks.map((check) => check.kind))) {
    const definitions = checks.filter((check) => check.kind === kind);

    for (const collector of collectorsFor(kind, definitions)) {
      if (!collectors.some((item) => item.kind === collector.kind)) {
        collectors.push(collector);
      }
    }
  }

  return collectors;
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

// Resolves the environment references of fill steps and API operation
// headers. An empty value is rejected too: CI systems commonly expand an
// unavailable secret to an empty string, and sending it would capture a
// different journey.
export const resolveFillValues = (
  recipe: Recipe,
  environment: Readonly<Record<string, string | undefined>>,
) => {
  const values = new Map<string, string>();
  const missing = { fill: new Set<string>(), header: new Set<string>() };

  const resolve = (name: string, use: keyof typeof missing) => {
    const value = environment[name];

    if (value === undefined || value === '') {
      missing[use].add(name);
    } else {
      values.set(name, value);
    }
  };

  for (const step of [...recipe.ready, ...recipe.steps]) {
    if (step.kind === 'fill' && typeof step.value !== 'string') {
      resolve(step.value.env, 'fill');
    }
  }

  for (const collector of recipe.collectors) {
    if (collector.kind === 'api') {
      for (const operation of collector.operations) {
        for (const header of operation.headers ?? []) {
          if ('env' in header) {
            resolve(header.env, 'header');
          }
        }
      }
    }
  }

  const problems = [
    missing.fill.size === 0
      ? null
      : `Fill value unavailable. Missing or empty environment variables: ${[...missing.fill].join(', ')}`,
    missing.header.size === 0
      ? null
      : `API header value unavailable. Missing or empty environment variables: ${[...missing.header].join(', ')}`,
  ].filter((problem) => problem !== null);

  return problems.length === 0
    ? Effect.succeed(values)
    : Effect.fail(new FillValueFailure({ message: problems.join('. ') }));
};
