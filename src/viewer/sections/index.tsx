import type { EvidenceKind } from '../../evidence-kinds';
import type { JourneySection } from '../../report-sections';
import type { ViewerSection } from './define';
import { ReactSection } from './react';
import { TextSection } from './text';

export const viewerSections: {
  readonly [K in EvidenceKind]: ViewerSection<K>;
} = { text: TextSection, react: ReactSection };

export function EvidenceSection<K extends EvidenceKind>({
  section,
}: {
  section: JourneySection<K>;
}) {
  const Section: ViewerSection<K> = viewerSections[section.kind];

  return <Section {...section.input} />;
}
