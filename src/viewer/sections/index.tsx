import type { EvidenceKind } from '../../evidence-kinds';
import type { JourneySection } from '../../report-sections';
import type { ViewerSection } from './define';
import { AccessibilitySection } from './accessibility';
import { PerformanceSection } from './performance';
import { ReactSection } from './react';
import { TextSection } from './text';

export const viewerSections: {
  readonly [K in EvidenceKind]: ViewerSection<K>;
} = {
  text: TextSection,
  react: ReactSection,
  accessibility: AccessibilitySection,
  performance: PerformanceSection,
};

export function EvidenceSection<K extends EvidenceKind>({
  section,
}: {
  section: JourneySection<K>;
}) {
  const Section: ViewerSection<K> = viewerSections[section.kind];

  return <Section {...section.input} />;
}
