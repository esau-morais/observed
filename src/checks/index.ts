import { Schema } from 'effect';
import type { EvidenceKind } from '../evidence-kinds';
import type { CheckKind } from './define';
import { accessibility } from './accessibility';
import { performance } from './performance';
import { reactRenders } from './react-renders';
import { requestCount } from './request-count';
import { text } from './text';

export const checkSchema = Schema.Union([
  requestCount.definition,
  text.definition,
  reactRenders.definition,
  accessibility.definition,
  performance.definition,
]);

export type CheckDefinition = typeof checkSchema.Type;

export type CheckKinds = {
  readonly [K in CheckDefinition['kind']]: CheckKind<
    Extract<CheckDefinition, { kind: K }>,
    EvidenceKind
  >;
};

export const checkKinds: CheckKinds = {
  'request-count': requestCount,
  text,
  'react-renders': reactRenders,
  accessibility,
  performance,
};
