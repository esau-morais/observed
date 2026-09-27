import type { Journey, Side } from '../comparison-model';
import { isEvidenceKind, type EvidenceKind } from '../evidence-kinds';
import type { MarkdownSection, SectionInput, SectionSide } from './define';
import { accessibility } from './accessibility';
import { api } from './api';
import { performance } from './performance';
import { playwright } from './playwright';
import { react } from './react';
import { browserErrors } from './browser-errors';
import { text } from './text';
import { timeline } from './timeline';

export const markdownSections: {
  readonly [K in EvidenceKind]: MarkdownSection<K>;
} = {
  text,
  react,
  accessibility,
  performance,
  timeline,
  'browser-errors': browserErrors,
  api,
  playwright,
};

function sectionSide<K extends EvidenceKind>(
  side: Side,
  kind: K,
): SectionSide<K> | null {
  if (side.execution === 'unavailable') {
    return null;
  }

  const evidence = side.evidence.find(
    (item): item is SectionSide<K>['evidence'] => item.kind === kind,
  );

  return evidence === undefined
    ? null
    : { evidence, artifacts: side.artifacts };
}

export type JourneySection<K extends EvidenceKind = EvidenceKind> = {
  readonly kind: K;
  readonly input: SectionInput<K>;
};

// The kind's section when the candidate recorded that kind, including a
// failed capture's evidence.
export function journeySection<K extends EvidenceKind>(
  journey: Journey,
  kind: K,
): JourneySection<K> | null {
  if (journey.candidate.execution === 'unavailable') {
    return null;
  }

  const after = sectionSide(journey.candidate, kind);

  return after === null
    ? null
    : {
        kind,
        input: {
          base: sectionSide(journey.base, kind),
          candidate: after,
          comparable: journey.comparison.kind === 'available',
        },
      };
}

// One section per supported evidence kind the candidate recorded.
export function journeySections(
  journey: Journey,
): JourneySection<EvidenceKind>[] {
  const candidate = journey.candidate;

  if (candidate.execution === 'unavailable') {
    return [];
  }

  return candidate.evidence.flatMap((view) => {
    if (!isEvidenceKind(view.kind)) {
      return [];
    }

    const section = journeySection(journey, view.kind);

    return section === null ? [] : [section];
  });
}

export function renderMarkdownSection<K extends EvidenceKind>(
  section: JourneySection<K>,
): string {
  const render: MarkdownSection<K> = markdownSections[section.kind];

  return render(section.input);
}
