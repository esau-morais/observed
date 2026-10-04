import { Schema } from 'effect';
import { text } from '../capture/model';
import { defineEvidence } from './define';

const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const reactLimits = {
  components: 500,
  mounted: 1000,
  subtree: 300,
  sources: 20,
} as const;

const unique = <T>(items: readonly T[], key: (item: T) => string) =>
  new Set(items.map(key)).size === items.length;

export const reactValueSchema = Schema.Struct({
  renderers: Schema.Array(
    Schema.Struct({
      version: Schema.NullOr(text),
      build: Schema.Literals(['development', 'production']),
    }),
  ),
  commits: count,
  components: Schema.Array(
    Schema.Struct({ name: text, mounts: count, updates: count }),
  ),
  mounted: Schema.Array(text),
  subtree: Schema.Array(
    Schema.Struct({ name: text, depth: count, rendered: Schema.Boolean }),
  ),
  sources: Schema.Array(
    Schema.Struct({
      component: text,
      script: text,
      line: count,
      column: count,
    }),
  ),
  truncated: Schema.Struct({
    components: Schema.Boolean,
    mounted: Schema.Boolean,
    subtree: Schema.Boolean,
  }),
}).check(
  Schema.makeFilter(
    (value) =>
      unique(value.components, (item) => item.name) &&
      unique(value.mounted, (name) => name) &&
      unique(value.sources, (item) => item.component) &&
      value.components.length <= reactLimits.components &&
      value.mounted.length <= reactLimits.mounted &&
      value.subtree.length <= reactLimits.subtree &&
      value.sources.length <= reactLimits.sources,
    {
      message:
        'React evidence must name components once and stay within its limits',
    },
  ),
);

export type ReactEvidence = typeof reactValueSchema.Type;

export const react = defineEvidence({
  kind: 'react',
  title: 'React renders',
  schemaVersion: 1,
  collector: {},
  value: reactValueSchema,
});

// A name missing from the counts rendered zero times only when it is mounted
// and the recording did not drop names at its component limit.
export function renderCount(
  value: ReactEvidence,
  component: string,
): number | null {
  const entry = value.components.find((item) => item.name === component);

  if (entry !== undefined) {
    return entry.mounts + entry.updates;
  }

  return value.mounted.includes(component) && !value.truncated.components
    ? 0
    : null;
}

export type RenderChange = {
  name: string;
  base: number;
  candidate: number;
};

// A component absent from one side's counts rendered zero times there, unless
// that side dropped names at its component limit; such rows are left out.
export function renderChanges(
  base: ReactEvidence,
  candidate: ReactEvidence,
): RenderChange[] {
  const totals = (value: ReactEvidence) =>
    new Map(
      value.components.map((item) => [item.name, item.mounts + item.updates]),
    );
  const before = totals(base);
  const after = totals(candidate);
  const known =
    (counts: Map<string, number>, value: ReactEvidence) => (name: string) =>
      counts.has(name) || !value.truncated.components;

  return [...new Set([...before.keys(), ...after.keys()])]
    .filter(known(before, base))
    .filter(known(after, candidate))
    .map((name) => ({
      name,
      base: before.get(name) ?? 0,
      candidate: after.get(name) ?? 0,
    }))
    .filter((change) => change.base !== change.candidate)
    .sort((left, right) => {
      const added = right.candidate - right.base - (left.candidate - left.base);

      return added === 0 ? left.name.localeCompare(right.name) : added;
    });
}

// Every React finding's subject starts with this, so a reader can tell which
// component a finding names.
export function renderSubjectPrefix(name: string): string {
  return `${name} render`;
}
