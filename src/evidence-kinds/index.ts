import { Schema } from 'effect';
import { text as nonEmpty } from '../capture/model';
import { accessibility } from './accessibility';
import { react } from './react';
import { text } from './text';

export const evidenceKinds = { text, react, accessibility } as const;

const kinds = Object.values(evidenceKinds);

export type EvidenceKind = keyof typeof evidenceKinds;

export type EvidenceValue<K extends EvidenceKind> =
  (typeof evidenceKinds)[K]['value']['Type'];

export const collectorSchema = Schema.Union(
  kinds.map((kind) => kind.collector),
);

export type CollectorConfig<K extends EvidenceKind = EvidenceKind> = Extract<
  typeof collectorSchema.Type,
  { kind: K }
>;

// Collected on every journey whether or not a check reads them.
export const defaultCollectors: readonly CollectorConfig[] = [
  { kind: 'accessibility' },
];

export const unavailableEvidenceSchema = Schema.Struct({
  kind: nonEmpty,
  status: Schema.Literal('unavailable'),
  reason: nonEmpty,
});

// Parsed evidence as the comparison result carries it for rendering.
export const evidenceViewSchema = Schema.Union([
  ...kinds.map((kind) => kind.recorded),
  unavailableEvidenceSchema,
]);

export type EvidenceView<K extends EvidenceKind = EvidenceKind> =
  | Extract<typeof evidenceViewSchema.Type, { kind: K; status: 'recorded' }>
  | typeof unavailableEvidenceSchema.Type;

export function isEvidenceKind(kind: string): kind is EvidenceKind {
  return Object.hasOwn(evidenceKinds, kind);
}
