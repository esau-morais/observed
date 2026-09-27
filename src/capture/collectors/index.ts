import type { CollectorConfig, EvidenceKind } from '../../evidence-kinds';
import type { Collector } from './define';
import { text } from './text';

export const collectors: { readonly [K in EvidenceKind]: Collector<K> } = {
  text,
};

export function collectorFor<K extends EvidenceKind>(
  config: CollectorConfig<K>,
): Collector<K> {
  return collectors[config.kind];
}
