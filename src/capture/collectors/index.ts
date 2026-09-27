import type { CollectorConfig, EvidenceKind } from '../../evidence-kinds';
import type { Collector } from './define';
import { accessibility } from './accessibility';
import { api } from './api';
import { performance } from './performance';
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
};

export function collectorFor<K extends EvidenceKind>(
  config: CollectorConfig<K>,
): Collector<K> {
  return collectors[config.kind];
}
