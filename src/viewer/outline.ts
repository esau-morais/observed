import type { CheckDefinition } from '../checks';
import type { CheckVerdict, Journey } from '../comparison-model';
import { evidenceKinds, type EvidenceKind } from '../evidence-kinds';
import { journeySections, type JourneySection } from '../report-sections';

export type SectionKey =
  | EvidenceKind
  | 'checks'
  | 'screenshots'
  | 'requests'
  | 'provenance'
  | 'limits';

export type SectionStatus =
  'failed' | 'unknown' | 'changed' | 'passed' | 'neutral';

export type OutlineSection = {
  readonly key: SectionKey;
  readonly title: string;
  readonly status: SectionStatus;
  readonly count: string;
  readonly checks: readonly CheckVerdict[];
  readonly evidence: JourneySection | null;
  readonly open: boolean;
};

export type Outline = {
  readonly sections: readonly OutlineSection[];
  readonly lead: SectionKey;
  // The section that shows each check's evidence, when one does.
  readonly placement: ReadonlyMap<string, SectionKey>;
  // Browser errors and requests render on the steps they were read in.
  readonly onSteps: boolean;
};

const checkSections: Record<
  CheckDefinition['kind'],
  EvidenceKind | 'requests'
> = {
  'request-count': 'requests',
  text: 'text',
  'react-renders': 'react',
  accessibility: 'accessibility',
  performance: 'performance',
  'browser-errors': 'browser-errors',
  'api-status': 'api',
  'api-schema': 'api',
  'api-readback': 'api',
};

const rank = {
  failed: 0,
  unknown: 1,
  changed: 2,
  passed: 3,
  neutral: 3,
} satisfies Record<SectionStatus, number>;

const verdictStatus = {
  regression: 'failed',
  failed: 'failed',
  unknown: 'unknown',
  'not-run': 'unknown',
  passed: 'passed',
} satisfies Record<CheckVerdict['verdict'], SectionStatus>;

function worst(statuses: readonly SectionStatus[]): SectionStatus {
  return statuses.reduce<SectionStatus>(
    (current, next) => (rank[next] < rank[current] ? next : current),
    'neutral',
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function sectionFor(
  journey: Journey,
  check: CheckVerdict,
  onSteps: boolean,
): SectionKey | null {
  const recorded = [...journey.candidate.checks, ...journey.base.checks].find(
    (entry) => entry.id === check.id,
  );

  if (recorded?.authority === 'Imported from Playwright') {
    return 'playwright';
  }

  const recipe = journey.candidate.recipe ?? journey.base.recipe;
  const kind = recipe?.checks.find((entry) => entry.id === check.id)?.kind;
  const section = kind === undefined ? null : checkSections[kind];

  return onSteps && (section === 'requests' || section === 'browser-errors')
    ? 'timeline'
    : section;
}

function evidenceCount(section: JourneySection): string {
  const view = section.input.candidate.evidence;

  if (view.status === 'unavailable') {
    return 'unavailable';
  }

  switch (view.kind) {
    case 'timeline':
      return plural(view.value.steps.length, 'step');
    case 'browser-errors':
      return plural(view.value.entries.length, 'error');
    case 'performance':
      return `n=${view.value.samples.filter((sample) => !sample.warmup).length}`;
    case 'accessibility':
      return plural(view.value.counts.violations, 'violation');
    case 'react':
      return plural(view.value.components.length, 'component');
    case 'api':
      return plural(view.value.operations.length, 'operation');
    case 'playwright':
      return plural(view.value.tests.length, 'test');
    case 'text':
      return plural(view.value.elements.length, 'element');
  }
}

function candidateErrors(sections: readonly JourneySection[]): number {
  const view = sections.find((section) => section.kind === 'browser-errors')
    ?.input.candidate.evidence;

  return view?.kind === 'browser-errors' && view.status === 'recorded'
    ? view.value.entries.length
    : 0;
}

function missingOnSteps(
  journey: Journey,
  evidence: readonly JourneySection[],
): string[] {
  const errors = evidence.find((section) => section.kind === 'browser-errors');
  const sides = [
    { label: '', side: journey.candidate, view: errors?.input.candidate },
    ...(journey.comparison.kind === 'preview'
      ? []
      : [{ label: 'base ', side: journey.base, view: errors?.input.base }]),
  ];
  const missing: string[] = [];

  for (const { label, side, view } of sides) {
    const record = view?.evidence;

    if (
      errors !== undefined &&
      (view === null || record?.status === 'unavailable')
    ) {
      missing.push(`${label}errors unavailable`);
    } else if (
      record?.kind === 'browser-errors' &&
      record.status === 'recorded' &&
      record.value.coverage.kind === 'incomplete'
    ) {
      missing.push(`${label}errors incomplete`);
    }

    if (side.execution !== 'complete') {
      missing.push(`${label}requests unavailable`);
    }
  }

  return missing;
}

function screenshots(
  journey: Journey,
): Pick<OutlineSection, 'status' | 'count'> {
  const comparison = journey.comparison;

  if (comparison.kind === 'preview') {
    return {
      status: journey.candidate.screenshot === null ? 'unknown' : 'neutral',
      count: journey.candidate.screenshot === null ? 'unavailable' : '1',
    };
  }

  if (comparison.kind === 'unavailable') {
    return { status: 'unknown', count: 'not compared' };
  }

  switch (comparison.visual.kind) {
    case 'identical':
      return { status: 'neutral', count: 'identical' };
    case 'below-threshold':
      return { status: 'neutral', count: 'below threshold' };
    case 'changed':
      return {
        status: 'changed',
        count: plural(comparison.visual.regions.length, 'region'),
      };
    case 'size-differs':
      return { status: 'changed', count: 'size differs' };
    case 'unavailable':
      return { status: 'unknown', count: 'unavailable' };
  }
}

function requestCount(journey: Journey): string {
  const side = journey.candidate;

  return side.execution === 'complete'
    ? plural(side.observations.requests.length, 'request')
    : 'unavailable';
}

export function outlineJourney(journey: Journey): Outline {
  const evidence = journeySections(journey);
  const onSteps = evidence.some((section) => section.kind === 'timeline');
  const byKey = new Map<SectionKey, CheckVerdict[]>();
  const placement = new Map<string, SectionKey>();

  for (const check of journey.checks) {
    const key = sectionFor(journey, check, onSteps);
    const present =
      key !== null &&
      (key === 'requests'
        ? !onSteps
        : evidence.some((section) => section.kind === key));

    if (present) {
      byKey.set(key, [...(byKey.get(key) ?? []), check]);
      placement.set(check.id, key);
    }
  }

  const statusOf = (key: SectionKey, own: SectionStatus[] = []) =>
    worst([
      ...own,
      ...(byKey.get(key) ?? []).map((check) => verdictStatus[check.verdict]),
    ]);

  const evidenceSections = evidence
    .filter((section) => !(onSteps && section.kind === 'browser-errors'))
    .map((section): OutlineSection => {
      const steps = section.kind === 'timeline';
      const errors = steps ? candidateErrors(evidence) : 0;
      const missing = steps ? missingOnSteps(journey, evidence) : [];
      const count = [
        evidenceCount(section),
        ...(errors === 0 ? [] : [plural(errors, 'error')]),
        ...missing,
      ].join(' · ');

      return {
        key: section.kind,
        title:
          section.kind === 'timeline'
            ? 'Steps'
            : evidenceKinds[section.kind].title,
        status: statusOf(section.kind, [
          section.input.candidate.evidence.status === 'unavailable' ||
          missing.length > 0
            ? 'unknown'
            : 'neutral',
        ]),
        count,
        checks: byKey.get(section.kind) ?? [],
        evidence: section,
        open: false,
      };
    });

  const passed = journey.checks.filter(
    (check) => check.verdict === 'passed',
  ).length;
  const sections: OutlineSection[] = [
    ...evidenceSections,
    ...(onSteps
      ? []
      : [
          {
            key: 'requests' as const,
            title: 'Requests',
            status: statusOf('requests', [
              journey.candidate.execution === 'complete'
                ? 'neutral'
                : 'unknown',
            ]),
            count: requestCount(journey),
            checks: byKey.get('requests') ?? [],
            evidence: null,
            open: false,
          },
        ]),
    {
      key: 'screenshots',
      title: 'Screenshots',
      ...screenshots(journey),
      checks: [],
      evidence: null,
      open: false,
    },
    {
      key: 'checks',
      title: 'Checks',
      status: worst(
        journey.checks.map((check) => verdictStatus[check.verdict]),
      ),
      count:
        journey.checks.length === 0
          ? 'none'
          : `${passed}/${journey.checks.length} passed`,
      checks: journey.checks,
      evidence: null,
      open: false,
    },
  ];
  const ordered = sections
    .map((section, index) => ({ section, index }))
    .sort((a, b) => {
      const byStatus = rank[a.section.status] - rank[b.section.status];

      return byStatus === 0 ? a.index - b.index : byStatus;
    })
    .map(({ section }) => section);
  const [first] = ordered;
  const lead =
    first !== undefined && rank[first.status] <= rank.changed
      ? first.key
      : 'screenshots';
  const leading = [
    ...ordered.filter((section) => section.key === lead),
    ...ordered.filter((section) => section.key !== lead),
  ];
  // The Checks index opens only for a failing or unknown check that no
  // evidence section shows.
  const unplaced = worst(
    journey.checks
      .filter((check) => !placement.has(check.id))
      .map((check) => verdictStatus[check.verdict]),
  );
  const opens = (section: OutlineSection) =>
    section.key === lead ||
    rank[section.key === 'checks' ? unplaced : section.status] <= rank.unknown;

  return {
    sections: [
      ...leading.map((section) => ({ ...section, open: opens(section) })),
      {
        key: 'provenance',
        title: 'Provenance',
        status: 'neutral',
        count: plural(
          [journey.base, journey.candidate].reduce(
            (sum, side) =>
              sum +
              side.artifacts.filter((item) => item.integrity === 'verified')
                .length,
            0,
          ),
          'file',
        ),
        checks: [],
        evidence: null,
        open: false,
      },
      {
        key: 'limits',
        title: 'Limits',
        status: 'neutral',
        count: String(journey.limitations.length),
        checks: [],
        evidence: null,
        open: false,
      },
    ],
    lead,
    placement,
    onSteps,
  };
}
