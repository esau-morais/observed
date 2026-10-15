import { Schema } from 'effect';
import type { EvidenceKind } from '../evidence';
import type { CheckKind } from './define';
import { baselineBrowserErrors, baselineServerErrors } from './baseline';
import { accessibility } from './accessibility';
import { apiReadback, apiSchema, apiStatus } from './api';
import { performance } from './performance';
import { reactRenders } from './react-renders';
import { browserErrors } from './browser-errors';
import { requestCount } from './request-count';
import { text } from './text';

export const savedCheckSchema = Schema.Union([
  requestCount.definition,
  text.definition,
  reactRenders.definition,
  accessibility.definition,
  performance.definition,
  browserErrors.definition,
  apiStatus.definition,
  apiSchema.definition,
  apiReadback.definition,
]);

export const checkSchema = Schema.Union([
  savedCheckSchema,
  baselineBrowserErrors.definition,
  baselineServerErrors.definition,
]);

export type CheckDefinition = typeof checkSchema.Type;

export type CheckKinds = {
  readonly [K in CheckDefinition['kind']]: CheckKind<
    Extract<CheckDefinition, { kind: K }>,
    EvidenceKind
  >;
};

export const checkKinds: CheckKinds = {
  'baseline-browser-errors': baselineBrowserErrors,
  'baseline-server-errors': baselineServerErrors,
  'request-count': requestCount,
  text,
  'react-renders': reactRenders,
  accessibility,
  performance,
  'browser-errors': browserErrors,
  'api-status': apiStatus,
  'api-schema': apiSchema,
  'api-readback': apiReadback,
};

// The kind that judges a definition, typed to accept that definition.
export function checkKind<K extends CheckDefinition['kind']>(
  definition: Extract<CheckDefinition, { kind: K }>,
): CheckKind<Extract<CheckDefinition, { kind: K }>, EvidenceKind> {
  const kind: CheckKinds[K] = checkKinds[definition.kind];

  return kind;
}
