import type { CheckDefinition } from '../checks';
import type { CheckVerdict, Journey } from '../comparison-model';
import { evidenceKinds, type EvidenceKind } from '../evidence-kinds';
import { renderChanges } from '../evidence-kinds/react';
import { journeySections, type JourneySection } from '../report-sections';
import { requestDiff } from '../request-diff';

export type SectionKey =
  | EvidenceKind
  | 'capture'
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
  // Sections left out because no side recorded their evidence.
  readonly unrecorded: readonly string[];
  readonly lead: SectionKey;
  // The section that shows each check's evidence, when one does.
  readonly placement: ReadonlyMap<string, SectionKey>;
  // Browser errors render on the steps they were read in.
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

  return onSteps && section === 'browser-errors' ? 'timeline' : section;
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
    case 'coverage':
      return plural(view.value.files.length, 'file');
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
  const timeline = evidence.find((section) => section.kind === 'timeline');
  const baseSteps = timeline?.input.base?.evidence;
  const sides = [
    { label: '', side: journey.candidate, view: errors?.input.candidate },
    ...(journey.comparison.kind === 'preview'
      ? []
      : [{ label: 'base ', side: journey.base, view: errors?.input.base }]),
  ];
  // The capture section explains a side that did not complete.
  const missing: string[] =
    journey.comparison.kind !== 'preview' &&
    journey.base.execution === 'complete' &&
    (baseSteps === undefined || baseSteps.status === 'unavailable')
      ? ['base steps unavailable']
      : [];

  for (const { label, side, view } of sides) {
    const record = view?.evidence;

    if (side.execution !== 'complete') {
      continue;
    }

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

function requests(journey: Journey): Pick<OutlineSection, 'status' | 'count'> {
  const { base, candidate } = journey;

  if (candidate.execution !== 'complete') {
    return { status: 'unknown', count: 'unavailable' };
  }

  const total = plural(candidate.observations.requests.length, 'request');

  if (journey.comparison.kind === 'preview') {
    return { status: 'neutral', count: total };
  }

  // The capture section explains a base that did not complete.
  if (base.execution !== 'complete') {
    return { status: 'neutral', count: `${total} · not compared` };
  }

  const rows = requestDiff(
    base.observations.requests,
    candidate.observations.requests,
  );
  const changed = rows.filter(
    (row) => row.change !== 'same' && row.change !== 'unknown',
  ).length;
  const unknown = rows.filter((row) => row.change === 'unknown').length;

  if (changed > 0) {
    return { status: 'changed', count: `${changed} changed · ${total}` };
  }

  return unknown === 0
    ? { status: 'neutral', count: `${total} · none changed` }
    : { status: 'neutral', count: `${unknown} status unknown · ${total}` };
}

function rendersChanged(section: JourneySection): boolean {
  const base = section.input.base?.evidence;
  const candidate = section.input.candidate.evidence;

  return (
    base?.kind === 'react' &&
    base.status === 'recorded' &&
    candidate.kind === 'react' &&
    candidate.status === 'recorded' &&
    renderChanges(base.value, candidate.value).length > 0
  );
}

function recorded(section: JourneySection): boolean {
  return (
    section.input.candidate.evidence.status === 'recorded' ||
    section.input.base?.evidence.status === 'recorded'
  );
}

function captureSection(journey: Journey): OutlineSection | null {
  const preview = journey.comparison.kind === 'preview';
  const sides = preview
    ? [{ name: 'capture', side: journey.candidate }]
    : [
        { name: 'base', side: journey.base },
        { name: 'candidate', side: journey.candidate },
      ];
  const incomplete = sides.filter(({ side }) => side.execution !== 'complete');
  const [only] = incomplete;

  if (only === undefined) {
    return null;
  }

  const outcome = incomplete.every(
    ({ side }) => side.execution === 'capture-failed',
  )
    ? 'failed'
    : 'unavailable';
  const state = incomplete.length === 2 ? `both ${outcome}` : outcome;

  return {
    key: 'capture',
    title: 'Capture',
    status: 'unknown',
    count: incomplete.length === 2 || preview ? state : `${only.name} ${state}`,
    checks: [],
    evidence: null,
    open: true,
  };
}

function checksCount(total: number, passed: number, unknown: number): string {
  if (total === 0) {
    return 'none';
  }

  return unknown === total ? `${unknown} unknown` : `${passed}/${total} passed`;
}

export function outlineJourney(journey: Journey): Outline {
  const all = journeySections(journey);
  const capture = captureSection(journey);
  const evidence = capture === null ? all : all.filter(recorded);
  const unrecorded = all
    .filter((section) => !evidence.includes(section))
    .map((section) =>
      section.kind === 'timeline' ? 'Steps' : evidenceKinds[section.kind].title,
    );
  const onSteps = evidence.some((section) => section.kind === 'timeline');
  const requestsRecorded =
    journey.candidate.execution === 'complete' ||
    (journey.comparison.kind !== 'preview' &&
      journey.base.execution === 'complete');
  const withRequests = capture === null || requestsRecorded;
  const byKey = new Map<SectionKey, CheckVerdict[]>();
  const placement = new Map<string, SectionKey>();

  for (const check of journey.checks) {
    const key = sectionFor(journey, check, onSteps);
    const present =
      key !== null &&
      (key === 'requests'
        ? withRequests
        : evidence.some((section) => section.kind === key));

    if (present) {
      byKey.set(key, [...(byKey.get(key) ?? []), check]);
      placement.set(check.id, key);
    } else if (capture !== null && verdictStatus[check.verdict] === 'unknown') {
      placement.set(check.id, 'capture');
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
          rendersChanged(section) ? 'changed' : 'neutral',
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
  const screenshotSection = screenshots(journey);
  const withoutScreenshots =
    capture !== null &&
    journey.candidate.screenshot === null &&
    journey.base.screenshot === null;
  const unknown = journey.checks.filter(
    (check) => verdictStatus[check.verdict] === 'unknown',
  ).length;
  const requestSection = requests(journey);
  const sections: OutlineSection[] = [
    ...(capture === null ? [] : [capture]),
    ...(withoutScreenshots
      ? []
      : [
          {
            key: 'screenshots' as const,
            title: 'Screenshots',
            ...screenshotSection,
            checks: [],
            evidence: null,
            open: false,
          },
        ]),
    ...(!withRequests
      ? []
      : [
          {
            key: 'requests' as const,
            title: 'Requests',
            status: statusOf('requests', [requestSection.status]),
            count: requestSection.count,
            checks: byKey.get('requests') ?? [],
            evidence: null,
            open: false,
          },
        ]),
    ...evidenceSections,
    {
      key: 'checks',
      title: 'Checks',
      status: worst(
        journey.checks.map((check) => verdictStatus[check.verdict]),
      ),
      count: checksCount(journey.checks.length, passed, unknown),
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
  // Failed or unknown evidence leads; otherwise the captured application does,
  // even when requests or renders changed.
  const lead =
    first !== undefined && rank[first.status] <= rank.unknown
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
    unrecorded: [
      ...unrecorded,
      ...(withRequests ? [] : ['Requests']),
      ...(withoutScreenshots ? ['Screenshots'] : []),
    ],
    lead,
    placement,
    onSteps,
  };
}

export function sectionId(prefix: string, key: SectionKey): string {
  return key === 'capture' ||
    key === 'checks' ||
    key === 'screenshots' ||
    key === 'requests' ||
    key === 'provenance' ||
    key === 'limits'
    ? `${prefix}${key}`
    : `${prefix}evidence-${key}`;
}
