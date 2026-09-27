import type { CollectorConfig, EvidenceKind } from '../../evidence-kinds';
import type { Collector } from './define';
import { accessibility } from './accessibility';
import { performance } from './performance';
import { react } from './react';
import { text } from './text';

export const collectors: { readonly [K in EvidenceKind]: Collector<K> } = {
  text,
  react,
  accessibility,
  performance,
};

export function collectorFor<K extends EvidenceKind>(
  config: CollectorConfig<K>,
): Collector<K> {
  return collectors[config.kind];
}
