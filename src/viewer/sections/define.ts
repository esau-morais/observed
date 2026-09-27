import type { ReactNode } from 'react';
import type { EvidenceKind } from '../../evidence-kinds';
import type { SectionInput } from '../../report-sections/define';

export type { SectionInput, SectionSide } from '../../report-sections/define';

// Rendered inside one disclosure titled with the kind's title.
export type ViewerSection<K extends EvidenceKind> = (
  props: SectionInput<K>,
) => ReactNode;
