import type { EvidenceKind } from '../../evidence-kinds';
import type { JourneySection } from '../../report-sections';
import type { ViewerSection } from './define';
import { AccessibilitySection } from './accessibility';
import { ApiSection } from './api';
import { PerformanceSection } from './performance';
import { PlaywrightSection } from './playwright';
import { ReactSection } from './react';
import { BrowserErrorsSection } from './browser-errors';
import { TextSection } from './text';
import { TimelineSection } from './timeline';

export const viewerSections: {
  readonly [K in EvidenceKind]: ViewerSection<K>;
} = {
  text: TextSection,
  react: ReactSection,
  accessibility: AccessibilitySection,
  performance: PerformanceSection,
  timeline: TimelineSection,
  'browser-errors': BrowserErrorsSection,
  api: ApiSection,
  playwright: PlaywrightSection,
};

export function EvidenceSection<K extends EvidenceKind>({
  section,
}: {
  section: JourneySection<K>;
}) {
  const Section: ViewerSection<K> = viewerSections[section.kind];

  return <Section {...section.input} />;
}
