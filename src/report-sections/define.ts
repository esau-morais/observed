import type { SideArtifact } from '../comparison-model';
import type { EvidenceKind, EvidenceView } from '../evidence-kinds';

export type SectionSide<K extends EvidenceKind> = {
  readonly evidence: EvidenceView<K>;
  // The side's artifacts with verified, report-relative paths, for linking
  // raw files the evidence value names.
  readonly artifacts: readonly SideArtifact[];
};

export type SectionInput<K extends EvidenceKind> = {
  // Null in a preview or when the base capture is unavailable.
  readonly base: SectionSide<K> | null;
  readonly candidate: SectionSide<K>;
  // Whether the journey's captures were compared.
  readonly comparable: boolean;
};

// Markdown body for report.md, rendered under a heading with the kind's
// title. Escape captured text with escapeText from markdown.ts.
export type MarkdownSection<K extends EvidenceKind> = (
  input: SectionInput<K>,
) => string;
