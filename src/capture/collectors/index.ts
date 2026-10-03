import { Effect } from 'effect';
import type { CollectorConfig, EvidenceKind } from '../../evidence-kinds';
import { EnvironmentValueFailure, type Collector } from './define';
import { accessibility } from './accessibility';
import { api } from './api';
import { coverage } from './coverage';
import { performance } from './performance';
import { playwright } from './playwright';
import { react } from './react';
import { browserErrors } from './browser-errors';
import { text } from './text';
import { timeline } from './timeline';

export const collectors: { readonly [K in EvidenceKind]: Collector<K> } = {
  text,
  react,
  accessibility,
  performance,
  timeline,
  'browser-errors': browserErrors,
  api,
  playwright,
  coverage,
};

export function collectorFor<K extends EvidenceKind>(
  config: CollectorConfig<K>,
): Collector<K> {
  return collectors[config.kind];
}

function environmentNames<K extends EvidenceKind>(
  config: CollectorConfig<K>,
): readonly string[] {
  return collectorFor(config).environment?.(config) ?? [];
}

// An empty value is rejected too, as for fill values.
export const resolveCollectorEnvironment = (
  configs: readonly CollectorConfig[],
  environment: Readonly<Record<string, string | undefined>>,
) => {
  const values = new Map<string, string>();
  const missing = new Set<string>();

  for (const name of configs.flatMap(environmentNames)) {
    const value = environment[name];

    if (value === undefined || value === '') {
      missing.add(name);
    } else {
      values.set(name, value);
    }
  }

  return missing.size === 0
    ? Effect.succeed(values)
    : Effect.fail(
        new EnvironmentValueFailure({
          message: `Collector environment value unavailable. Missing or empty environment variables: ${[...missing].join(', ')}`,
        }),
      );
};
