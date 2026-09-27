import type { Journey, Side } from '../comparison-model';
import { isEvidenceKind, type EvidenceKind } from '../evidence-kinds';
import type { MarkdownSection, SectionInput, SectionSide } from './define';
import { text } from './text';

export const markdownSections: {
  readonly [K in EvidenceKind]: MarkdownSection<K>;
} = { text };

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

// One section per supported evidence kind the candidate recorded, including
// a failed capture's evidence.
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

    const after = sectionSide(candidate, view.kind);

    return after === null
      ? []
      : [
          {
            kind: view.kind,
            input: {
              base: sectionSide(journey.base, view.kind),
              candidate: after,
            },
          },
        ];
  });
}

export function renderMarkdownSection<K extends EvidenceKind>(
  section: JourneySection<K>,
): string {
  const render: MarkdownSection<K> = markdownSections[section.kind];

  return render(section.input);
}
