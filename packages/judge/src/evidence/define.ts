import { Schema } from 'effect';

export type EvidenceDefinition<
  K extends string,
  C extends Schema.Struct.Fields,
  V extends Schema.Codec<unknown, unknown>,
> = {
  kind: K;
  title: string;
  schemaVersion: number;
  collector: Schema.Struct<{ kind: Schema.Literal<K> } & C>;
  value: V;
  file: Schema.Struct<{
    kind: Schema.Literal<K>;
    schemaVersion: Schema.Literal<number>;
    value: V;
  }>;
  recorded: Schema.Struct<{
    kind: Schema.Literal<K>;
    status: Schema.Literal<'recorded'>;
    value: V;
  }>;
};

// One evidence kind: what its collector is configured with, and the value its
// versioned artifact file holds. Schemas only, so the viewer can bundle it.
export function defineEvidence<
  const K extends string,
  C extends Schema.Struct.Fields,
  V extends Schema.Codec<unknown, unknown>,
>(options: {
  kind: K;
  title: string;
  schemaVersion: number;
  collector: C;
  value: V;
}): EvidenceDefinition<K, C, V> {
  const kind = Schema.Literal(options.kind);

  return {
    ...options,
    collector: Schema.Struct({ kind, ...options.collector }),
    file: Schema.Struct({
      kind,
      schemaVersion: Schema.Literal(options.schemaVersion),
      value: options.value,
    }),
    recorded: Schema.Struct({
      kind,
      status: Schema.Literal('recorded'),
      value: options.value,
    }),
  };
}
