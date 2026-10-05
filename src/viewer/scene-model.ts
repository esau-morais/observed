import type {
  Anchor,
  ChangeScope,
  CheckVerdict,
  Journey,
  Side,
} from '../comparison-model';
import type { EvidenceValue } from '../evidence-kinds';
import { describeAction, errorSourceLabels } from '../interaction-text';
import { shortSource } from '../provenance-text';
import { describeStatus } from '../request-text';
import { diffLines, lines } from '../source-diff';
import { anchorWords, fromRepositoryRoot } from '../result-text';

type Step = EvidenceValue<'timeline'>['steps'][number];
type BrowserError = EvidenceValue<'browser-errors'>['entries'][number];
type Request = Extract<
  Side,
  { execution: 'complete' }
>['observations']['requests'][number];

export type Phase = 'base' | 'candidate' | 'source';

export type Tone = 'quiet' | 'active' | 'checked' | 'regression' | 'unknown';

export type EntityKind = 'journey' | 'page' | 'request' | 'errors' | 'check';

export type Entity = { id: string; kind: EntityKind; title: string };

export type EntityState = {
  line: string;
  tone: Tone;
  // A step is running in this entity; the scene draws a spinner.
  busy: boolean;
};

export type Edge = {
  from: string;
  to: string;
  kind: 'drives' | 'requested' | 'threw' | 'checked';
};

export type Beat = {
  phase: Phase;
  // Recorded time since the side's first step started, and the step shown.
  clock: { step: number; steps: number; elapsed: number } | null;
  states: ReadonlyMap<string, EntityState>;
  lit: readonly string[];
  caption: string;
  // Part of the caption drawn in a status color, as the red moment's values.
  emphasis: { text: string; tone: Tone } | null;
  screenshot: string | null;
  // How long autoplay holds the beat, in milliseconds.
  hold: number;
};

export type Scene = {
  title: string;
  revisions: { base: string; candidate: string };
  entities: readonly Entity[];
  edges: readonly Edge[];
  beats: readonly Beat[];
  check: CheckVerdict | null;
  source: {
    anchor: Anchor;
    place: string;
    words: string;
    base: string | null;
    candidate: string | null;
  } | null;
};

type Recorded = {
  side: Extract<Side, { execution: 'complete' }>;
  steps: readonly Step[];
  errors: readonly BrowserError[] | null;
};

const maxRequestBoxes = 3;

const holds = { open: 1800, step: 1500, result: 2600, source: 5000 };

function recordedSide(side: Side): Recorded | null {
  if (side.execution !== 'complete') {
    return null;
  }

  let steps: readonly Step[] | null = null;
  let errors: readonly BrowserError[] | null = null;

  for (const view of side.evidence) {
    if (view.status !== 'recorded') {
      continue;
    }

    if (view.kind === 'timeline') {
      steps = view.value.steps;
    } else if (view.kind === 'browser-errors') {
      errors = view.value.entries;
    }
  }

  return steps === null || steps.length === 0 ? null : { side, steps, errors };
}

function route(request: Request): string {
  return `${request.method} ${request.origin === 'application' ? '' : request.origin}${request.path}`;
}

function firstLine(text: string): string {
  return text.split('\n')[0]?.trim() ?? '';
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

// The check the scene turns on: the first one that failed, otherwise the
// first with a measure on both sides.
function focusCheck(journey: Journey): CheckVerdict | null {
  return (
    journey.checks.find(
      (check) => check.verdict === 'regression' || check.verdict === 'failed',
    ) ??
    journey.checks.find((check) => check.measure !== undefined) ??
    null
  );
}

function checkKind(journey: Journey, check: CheckVerdict): string | null {
  const recipe = journey.candidate.recipe ?? journey.base.recipe;

  return recipe?.checks.find((entry) => entry.id === check.id)?.kind ?? null;
}

function checkedRoute(journey: Journey, check: CheckVerdict): string | null {
  const recipe = journey.candidate.recipe ?? journey.base.recipe;
  const definition = recipe?.checks.find((entry) => entry.id === check.id);

  return definition?.kind === 'request-count'
    ? `${definition.method} ${definition.origin ?? ''}${definition.path}`
    : null;
}

// The last step that started at or before the request, or -1 for a request
// before every step.
function stepOf(steps: readonly Step[], request: Request): number {
  let found = -1;

  for (const step of steps) {
    if (
      step.outcome !== 'not-run' &&
      Date.parse(step.startedAt) <= Date.parse(request.startedAt)
    ) {
      found = step.index;
    }
  }

  return found;
}

function stepLine(step: Step): string {
  const action = describeAction(step.action).toLowerCase();

  return step.target === null ? action : `${action} ${step.target}`;
}

// Milliseconds from the first step's start to the end of this one.
function elapsed(steps: readonly Step[], step: Step): number {
  const [first] = steps;

  return first === undefined ||
    first.outcome === 'not-run' ||
    step.outcome === 'not-run'
    ? 0
    : Date.parse(step.finishedAt) - Date.parse(first.startedAt);
}

function requestLine(requests: readonly Request[]): string {
  if (requests.length === 0) {
    return 'not requested';
  }

  const statuses = [...new Set(requests.map((request) => request.status))];
  const status = statuses.map(describeStatus).join(', ');

  return requests.length === 1 ? status : `${status} · ×${requests.length}`;
}

function sideCheck(side: Side, check: CheckVerdict) {
  return side.checks.find((entry) => entry.id === check.id) ?? null;
}

const stepTones = {
  completed: 'active',
  failed: 'regression',
  'not-run': 'unknown',
} satisfies Record<Step['outcome'], Tone>;

const outcomeTones = {
  passed: 'checked',
  failed: 'regression',
  unknown: 'unknown',
  'not-run': 'unknown',
} satisfies Record<Side['checks'][number]['outcome'], Tone>;

const verdictTones = {
  regression: 'regression',
  failed: 'regression',
  unknown: 'unknown',
  'not-run': 'unknown',
  passed: 'checked',
} satisfies Record<CheckVerdict['verdict'], Tone>;

const verdictWords = {
  regression: '✕ regression',
  failed: '✕ failed',
  unknown: '? unknown',
  'not-run': '? not run',
  passed: '✓ passed',
} satisfies Record<CheckVerdict['verdict'], string>;

const outcomeWords = {
  passed: '✓ passed',
  failed: '✕ failed',
  unknown: '? unknown',
  'not-run': '? not run',
} satisfies Record<Side['checks'][number]['outcome'], string>;

// The check box and caption once a side's steps end: the base's own outcome,
// then the verdict, which compares both sides.
function checkResult(
  check: CheckVerdict,
  phase: 'base' | 'candidate',
  own: Side['checks'][number] | null,
): { state: EntityState; caption: string; emphasis: Beat['emphasis'] } {
  const { measure } = check;

  if (phase === 'base') {
    const outcome = own === null ? 'not recorded' : own.outcome;
    const base = measure?.base ?? null;
    const value =
      measure === undefined || base === null
        ? ''
        : ` ${measure.label.toLowerCase()} ${base},`;

    return {
      state: {
        line: [
          own === null ? '? not recorded' : outcomeWords[own.outcome],
          ...(base === null ? [] : [base]),
        ].join(' · '),
        tone: own === null ? 'unknown' : outcomeTones[own.outcome],
        busy: false,
      },
      caption: `${check.name} on the base:${value} ${outcome}.`,
      emphasis: null,
    };
  }

  const tone = verdictTones[check.verdict];
  const state = {
    line: [
      verdictWords[check.verdict],
      ...(measure === undefined
        ? []
        : [`${measure.base ?? '?'} → ${measure.candidate ?? '?'}`]),
    ].join(' · '),
    tone,
    busy: false,
  };

  if (measure === undefined) {
    return {
      state,
      caption: `${check.name}: ${check.verdict}.`,
      emphasis: null,
    };
  }

  const after = `${measure.candidate ?? 'unknown'} after`;

  return {
    state,
    caption: `${check.name}: ${measure.label.toLowerCase()} ${measure.base ?? 'unknown'} before, ${after}. Limit: ${measure.limit ?? check.expectation}.`,
    emphasis: { text: after, tone },
  };
}

function sourceArtifact(side: Side, path: string): string | null {
  const file = side.artifacts.find(
    (artifact) =>
      artifact.integrity === 'verified' &&
      artifact.path.endsWith(`/source/${path}`),
  );

  return file?.integrity === 'verified' ? file.path : null;
}

function sourceOf(
  journey: Journey,
  check: CheckVerdict | null,
  scope: ChangeScope | undefined,
): Scene['source'] {
  const finding = journey.findings.find(
    (item) =>
      item.location.kind === 'anchored' &&
      (check === null || item.checks.includes(check.id)),
  );

  if (finding?.location.kind !== 'anchored') {
    return null;
  }

  const [anchor] = finding.location.anchors;

  return {
    anchor,
    place: `${scope === undefined ? anchor.path : fromRepositoryRoot(scope, anchor.path)}:${anchor.line}`,
    words:
      anchor.basis === 'stack-frame' && finding.subject === 'Console error'
        ? 'logged at'
        : anchorWords[anchor.basis],
    base: sourceArtifact(journey.base, anchor.path),
    candidate: sourceArtifact(journey.candidate, anchor.path),
  };
}

const anchorDiffWords = {
  added: 'a line this change added',
  removed: 'a line this change removed',
  context: 'next to lines this change edited',
  unchanged: 'a line this change did not edit',
  unknown: 'the snapshots could not be compared',
} satisfies Record<Anchor['diff'], string>;

// A before and after scene drawn from one journey's recorded evidence: its
// steps, requests, browser errors, screenshots, the check that decides the
// verdict and the source line its evidence points at. Every state line and
// caption restates a recorded value; nothing is inferred. Null when either
// side lacks recorded steps, since the scene would have nothing to replay.
export function sceneOf(journey: Journey, scope?: ChangeScope): Scene | null {
  if (journey.comparison.kind === 'preview') {
    return null;
  }

  const base = recordedSide(journey.base);
  const candidate = recordedSide(journey.candidate);

  if (base === null || candidate === null) {
    return null;
  }

  const check = focusCheck(journey);
  const kind = check === null ? null : checkKind(journey, check);
  const focusRoute = check === null ? null : checkedRoute(journey, check);
  const routes = [
    ...new Set([
      ...(focusRoute === null ? [] : [focusRoute]),
      ...[base, candidate].flatMap(({ side }) =>
        side.observations.requests.map(route),
      ),
    ]),
  ];
  const shownRoutes = routes.slice(0, maxRequestBoxes);
  const hiddenRoutes = routes.length - shownRoutes.length;
  const withErrors =
    kind === 'browser-errors' ||
    (base.errors?.length ?? 0) + (candidate.errors?.length ?? 0) > 0;
  const entities: Entity[] = [
    {
      id: 'journey',
      kind: 'journey',
      title: candidate.side.capture.manifest.producer.name,
    },
    { id: 'page', kind: 'page', title: 'page' },
    ...shownRoutes.map((name) => ({
      id: `request:${name}`,
      kind: 'request' as const,
      title: name,
    })),
    ...(hiddenRoutes > 0
      ? [
          {
            id: 'request:more',
            kind: 'request' as const,
            title: `+${plural(hiddenRoutes, 'route')}`,
          },
        ]
      : []),
    ...(withErrors
      ? [{ id: 'errors', kind: 'errors' as const, title: 'browser errors' }]
      : []),
    ...(check === null
      ? []
      : [{ id: 'check', kind: 'check' as const, title: check.name }]),
  ];
  let checkedEntity = 'page';

  if (kind === 'browser-errors' && withErrors) {
    checkedEntity = 'errors';
  } else if (focusRoute !== null && shownRoutes.includes(focusRoute)) {
    checkedEntity = `request:${focusRoute}`;
  }

  const edges: Edge[] = [
    { from: 'journey', to: 'page', kind: 'drives' },
    ...entities
      .filter((entity) => entity.kind === 'request')
      .map((entity) => ({
        from: 'page',
        to: entity.id,
        kind: 'requested' as const,
      })),
    ...(withErrors
      ? [{ from: 'page', to: 'errors', kind: 'threw' as const }]
      : []),
    ...(check === null
      ? []
      : [{ from: checkedEntity, to: 'check', kind: 'checked' as const }]),
  ];
  const source = sourceOf(journey, check, scope);
  const revisions = {
    base: shortSource(base.side.capture.manifest.source),
    candidate: shortSource(candidate.side.capture.manifest.source),
  };

  const sideBeats = (recorded: Recorded, phase: 'base' | 'candidate') => {
    const { side, steps, errors } = recorded;
    const requests = side.observations.requests;
    const label = phase === 'base' ? 'Before' : 'After';
    const states = new Map<string, EntityState>();
    const set = (id: string, state: EntityState) => {
      if (entities.some((entity) => entity.id === id)) {
        states.set(id, state);
      }
    };

    const snapshot = () => new Map(states);
    const beats: Beat[] = [];
    const requestsUpTo = (index: number) =>
      requests.filter((request) => stepOf(steps, request) <= index);
    const errorsUpTo = (index: number) =>
      (errors ?? []).filter((error) => (error.step ?? -1) <= index);
    // A route's box is active on the step that sent its request.
    const showRequests = (index: number) => {
      const seen = requestsUpTo(index);
      const sent = new Set(
        seen.filter((request) => stepOf(steps, request) === index).map(route),
      );

      for (const name of shownRoutes) {
        const matching = seen.filter((request) => route(request) === name);

        set(`request:${name}`, {
          line: requestLine(matching),
          tone: sent.has(name) ? 'active' : 'quiet',
          busy: false,
        });
      }

      if (hiddenRoutes > 0) {
        const others = seen.filter(
          (request) => !shownRoutes.includes(route(request)),
        );

        set('request:more', {
          line: plural(others.length, 'request'),
          tone: others.some((request) => sent.has(route(request)))
            ? 'active'
            : 'quiet',
          busy: false,
        });
      }
    };

    const showErrors = (index: number) => {
      if (errors === null) {
        set('errors', { line: 'not recorded', tone: 'unknown', busy: false });

        return;
      }

      const seen = errorsUpTo(index);
      const [latest] = seen.slice(-1);

      set('errors', {
        line:
          latest === undefined
            ? 'none'
            : `${seen.length > 1 ? `${seen.length} · ` : ''}${firstLine(latest.text)}`,
        tone: latest === undefined ? 'quiet' : 'regression',
        busy: false,
      });
    };

    set('journey', {
      line: `${plural(steps.length, 'step')} from ${side.recipe.path}`,
      tone: 'quiet',
      busy: false,
    });
    set('page', { line: side.recipe.path, tone: 'quiet', busy: false });
    showRequests(-1);
    showErrors(-1);

    if (check !== null) {
      set('check', {
        line: check.measure?.limit ?? check.expectation,
        tone: 'quiet',
        busy: false,
      });
    }

    beats.push({
      phase,
      clock: { step: 0, steps: steps.length, elapsed: 0 },
      states: snapshot(),
      lit: [],
      caption: `${label}: ${phase} ${revisions[phase]}, ${plural(steps.length, 'recorded step')}.`,
      emphasis: null,
      screenshot: null,
      hold: holds.open,
    });

    for (const step of steps) {
      const before = requestsUpTo(step.index - 1).length;
      const newRequests = requestsUpTo(step.index).slice(before);
      const errorsBefore = errorsUpTo(step.index - 1).length;
      const newErrors = errorsUpTo(step.index).slice(errorsBefore);
      const lit = [
        'journey→page',
        ...newRequests.map((request) => {
          const name = route(request);

          return `page→request:${shownRoutes.includes(name) ? name : 'more'}`;
        }),
        ...(newErrors.length > 0 ? ['page→errors'] : []),
      ];
      const parts = [`Step ${step.index + 1}: ${stepLine(step)}`];

      if (step.outcome === 'failed') {
        parts.push('the step failed');
      } else if (step.outcome === 'not-run') {
        parts.push('not run');
      }

      for (const request of newRequests) {
        parts.push(
          `${route(request)} answered ${describeStatus(request.status)}`,
        );
      }

      for (const error of newErrors) {
        parts.push(
          `${errorSourceLabels[error.source]}: ${firstLine(error.text)}`,
        );
      }

      set('journey', {
        line: stepLine(step),
        tone: stepTones[step.outcome],
        busy: step.outcome === 'completed',
      });
      showRequests(step.index);
      showErrors(step.index);
      beats.push({
        phase,
        clock: {
          step: step.index + 1,
          steps: steps.length,
          elapsed: elapsed(steps, step),
        },
        states: snapshot(),
        lit: [...new Set(lit)],
        caption: `${parts.join('. ')}.`,
        emphasis: null,
        screenshot: null,
        hold: holds.step,
      });
    }

    const last = steps.at(-1);
    const result =
      check === null
        ? {
            state: null,
            caption: `${label}: ${plural(steps.length, 'step')} recorded, no check configured.`,
            emphasis: null,
          }
        : checkResult(check, phase, sideCheck(side, check));

    if (result.state !== null) {
      set('check', result.state);
    }

    showRequests(steps.length);
    set('journey', {
      line:
        last === undefined
          ? 'no steps'
          : `${plural(steps.filter((step) => step.outcome === 'completed').length, 'step')} completed`,
      tone: 'quiet',
      busy: false,
    });
    set('page', {
      line: `${side.recipe.path} after the steps`,
      tone: 'quiet',
      busy: false,
    });
    beats.push({
      phase,
      clock:
        last === undefined
          ? null
          : {
              step: steps.length,
              steps: steps.length,
              elapsed: elapsed(steps, last),
            },
      states: snapshot(),
      lit: check === null ? [] : [`${checkedEntity}→check`],
      caption: result.caption,
      emphasis: result.emphasis,
      screenshot: side.screenshot,
      hold: holds.result,
    });

    return beats;
  };

  const beats = [
    ...sideBeats(base, 'base'),
    ...sideBeats(candidate, 'candidate'),
  ];
  const final = beats.at(-1);

  if (source !== null && final !== undefined) {
    beats.push({
      ...final,
      phase: 'source',
      lit: [],
      caption: `${source.words.charAt(0).toUpperCase()}${source.words.slice(1)} ${source.place}, ${anchorDiffWords[source.anchor.diff]}. ${source.anchor.evidence}`,
      emphasis: null,
      hold: holds.source,
    });
  }

  return {
    title: journey.title,
    revisions,
    entities,
    edges,
    beats,
    check,
    source,
  };
}

export function edgeId(edge: Edge): string {
  return `${edge.from}→${edge.to}`;
}

export type CodeLine = {
  text: string;
  change: 'added' | 'removed' | 'same';
  // The line's number in the anchor's snapshot, null for a line only the
  // other snapshot has.
  number: number | null;
  anchor: boolean;
};

// The lines around an anchor as one diff, the base's removed lines before
// the candidate's added ones, with their common indentation removed. Without
// the other snapshot, or when the snapshots are too large to diff, the
// anchor's own file is shown unmarked.
export function sourceWindow(input: {
  anchor: Anchor;
  base: string | null;
  candidate: string | null;
  around?: number;
}): CodeLine[] | null {
  const { anchor, base, candidate } = input;
  const around = input.around ?? 4;
  const own = anchor.side === 'base' ? base : candidate;

  if (own === null) {
    return null;
  }

  const diff =
    base === null || candidate === null ? null : diffLines(base, candidate);
  const left = base === null ? [] : lines(base);
  const right = candidate === null ? [] : lines(candidate);
  const merged: CodeLine[] = [];

  if (diff === null) {
    for (const [index, text] of lines(own).entries()) {
      merged.push({
        text,
        change: 'same',
        number: index + 1,
        anchor: index + 1 === anchor.line,
      });
    }
  } else {
    let i = 0;
    let j = 0;

    while (i < left.length || j < right.length) {
      if (i < left.length && diff.base[i] === 'removed') {
        merged.push({
          text: left[i] ?? '',
          change: 'removed',
          number: anchor.side === 'base' ? i + 1 : null,
          anchor: anchor.side === 'base' && i + 1 === anchor.line,
        });
        i++;
      } else if (j < right.length && diff.candidate[j] === 'added') {
        merged.push({
          text: right[j] ?? '',
          change: 'added',
          number: anchor.side === 'candidate' ? j + 1 : null,
          anchor: anchor.side === 'candidate' && j + 1 === anchor.line,
        });
        j++;
      } else {
        const number = anchor.side === 'base' ? i + 1 : j + 1;

        merged.push({
          text: (anchor.side === 'base' ? left[i] : right[j]) ?? '',
          change: 'same',
          number,
          anchor: number === anchor.line,
        });
        i++;
        j++;
      }
    }
  }

  const at = merged.findIndex((line) => line.anchor);

  if (at === -1) {
    return null;
  }

  const shown = merged.slice(Math.max(0, at - around), at + around + 1);
  const indent = Math.min(
    ...shown
      .filter((line) => line.text.trim() !== '')
      .map((line) => /^[ \t]*/.exec(line.text)?.[0].length ?? 0),
  );

  return shown.map((line) => ({
    ...line,
    text: line.text.slice(Number.isFinite(indent) ? indent : 0),
  }));
}
