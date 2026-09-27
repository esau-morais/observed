import * as stylex from '@stylexjs/stylex';
import { use, type ReactNode } from 'react';
import type { Side } from '../../comparison-model';
import type { EvidenceValue } from '../../evidence-kinds';
import {
  describeAction,
  describeDuration,
  describeErrorCoverage,
  errorSourceLabels,
  stepOutcomeLabels,
} from '../../interaction-text';
import { describeStatus } from '../../request-text';
import { toneSymbols } from '../../result-text';
import { fonts, geometry, media } from '../constants.stylex';
import { HeadingLevel, SubHeading } from '../heading';
import { colors } from '../tokens.stylex';
import type { SectionSide, ViewerSection } from './define';

type Step = EvidenceValue<'timeline'>['steps'][number];
type BrowserError = EvidenceValue<'browser-errors'>['entries'][number];
type Request = Extract<
  Side,
  { execution: 'complete' }
>['observations']['requests'][number];

const styles = stylex.create({
  grid: {
    display: 'grid',
    alignItems: 'start',
    gap: 24,
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      [media.desktop]: 'repeat(2, minmax(0, 1fr))',
    },
  },
  stack: { display: 'grid', gap: 12, alignContent: 'start', minWidth: 0 },
  heading: { fontSize: '1.125rem', fontWeight: 500, lineHeight: 1.35 },
  text: { color: colors.textSecondary, maxWidth: '68ch' },
  caption: { color: colors.textMuted, fontSize: '0.8125rem' },
  mono: {
    fontFamily: fonts.mono,
    fontSize: '0.8125rem',
    overflowWrap: 'anywhere',
  },
  missing: {
    backgroundColor: colors.unknownFill,
    borderRadius: geometry.radius,
    color: colors.unknown,
    padding: 16,
  },
  steps: {
    borderColor: colors.border,
    borderRadius: geometry.radius,
    borderStyle: 'solid',
    borderWidth: 1,
    display: 'grid',
    listStyle: 'none',
    margin: 0,
    padding: 0,
  },
  step: {
    borderTopColor: colors.border,
    borderTopStyle: { default: 'solid', ':first-child': 'none' },
    borderTopWidth: 1,
    display: 'grid',
    gap: 8,
    minWidth: 0,
    paddingBlock: 12,
    paddingInline: 16,
  },
  stepLine: {
    alignItems: 'baseline',
    display: 'flex',
    flexWrap: 'wrap',
    columnGap: 12,
    rowGap: 4,
  },
  index: {
    color: colors.textMuted,
    fontFamily: fonts.mono,
    fontSize: '0.8125rem',
    fontVariantNumeric: 'tabular-nums',
    minWidth: '2ch',
  },
  action: { fontWeight: 500 },
  failed: { color: colors.unknown, fontWeight: 500 },
  attached: { display: 'grid', gap: 8, margin: 0, paddingInlineStart: 0 },
  error: {
    backgroundColor: colors.surface,
    borderColor: colors.borderControl,
    borderRadius: 8,
    borderStyle: 'solid',
    borderWidth: 1,
    display: 'grid',
    gap: 4,
    listStyle: 'none',
    minWidth: 0,
    padding: 12,
  },
  message: {
    fontFamily: fonts.mono,
    fontSize: '0.8125rem',
    margin: 0,
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
  },
  request: {
    fontFamily: fonts.mono,
    fontSize: '0.8125rem',
    listStyle: 'none',
    overflowWrap: 'anywhere',
  },
  summary: {
    alignContent: 'center',
    cursor: 'pointer',
    minHeight: geometry.target,
    outlineColor: { default: colors.focus, [media.forcedColors]: 'Highlight' },
    outlineOffset: 3,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
  },
  scroll: {
    borderColor: colors.border,
    borderRadius: geometry.radius,
    borderStyle: 'solid',
    borderWidth: 1,
    maxHeight: '32rem',
    overflow: 'auto',
    outlineColor: { default: colors.focus, [media.forcedColors]: 'Highlight' },
    outlineOffset: 3,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
  },
  contained: { minWidth: 0 },
  tree: {
    fontFamily: fonts.mono,
    fontSize: '0.8125rem',
    margin: 0,
    padding: 16,
    whiteSpace: 'pre',
  },
});

// Requests are null when the side recorded none that can be trusted.
export type StepsSide = {
  readonly timeline: SectionSide<'timeline'>;
  readonly errors: SectionSide<'browser-errors'> | null;
  readonly requests: readonly Request[] | null;
};

function ErrorEntry({ error }: { error: BrowserError }) {
  const [first = '', ...rest] = error.text.split('\n');

  return (
    <li {...stylex.props(styles.error)}>
      <span {...stylex.props(styles.caption)}>
        {errorSourceLabels[error.source]}
      </span>
      <p {...stylex.props(styles.message)}>
        {first === '' ? '(empty message)' : first}
      </p>
      {rest.length === 0 ? null : (
        <details {...stylex.props(styles.contained)}>
          <summary {...stylex.props(styles.summary)}>Full message</summary>
          <pre {...stylex.props(styles.message)}>{error.text}</pre>
        </details>
      )}
    </li>
  );
}

function Attached({
  errors,
  requests,
}: {
  errors: readonly BrowserError[];
  requests: readonly Request[];
}) {
  if (errors.length === 0 && requests.length === 0) {
    return null;
  }

  return (
    <ul {...stylex.props(styles.attached)}>
      {errors.map((error, index) => (
        <ErrorEntry key={`error-${index}`} error={error} />
      ))}
      {requests.map((request, index) => (
        <li key={`request-${index}`} {...stylex.props(styles.request)}>
          {request.method}{' '}
          {request.origin === 'application' ? '' : request.origin}
          {request.path} · {describeStatus(request.status)}
        </li>
      ))}
    </ul>
  );
}

// The last step that started at or before the request, or -1 when the
// request started before every step.
function stepOfRequest(steps: readonly Step[], request: Request): number {
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

function StateHeading() {
  const Heading = use(HeadingLevel) === 3 ? 'h4' : 'h5';

  return <Heading {...stylex.props(styles.heading)}>Resulting state</Heading>;
}

function Group({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <li {...stylex.props(styles.step)}>
      <div {...stylex.props(styles.stepLine)}>{label}</div>
      {children}
    </li>
  );
}

function StepLabel({ step }: { step: Step }) {
  return (
    <>
      <span {...stylex.props(styles.index)}>{step.index + 1}</span>
      <span {...stylex.props(styles.action)}>
        {describeAction(step.action)}
      </span>
      {step.target === null ? null : (
        <span {...stylex.props(styles.mono)}>{step.target}</span>
      )}
      <span {...stylex.props(styles.caption)}>{describeDuration(step)}</span>
      {step.outcome === 'completed' ? null : (
        <span
          {...stylex.props(
            step.outcome === 'failed' ? styles.failed : styles.caption,
          )}
        >
          {step.outcome === 'failed' ? (
            <span aria-hidden="true">{toneSymbols.unknown} </span>
          ) : null}
          {stepOutcomeLabels[step.outcome]}
        </span>
      )}
    </>
  );
}

function ErrorCoverage({ side }: { side: StepsSide }) {
  const view = side.errors?.evidence ?? null;

  if (view === null) {
    return null;
  }

  const complete =
    view.status === 'recorded' && view.value.coverage.kind === 'complete';

  return (
    <p {...stylex.props(complete ? styles.caption : styles.missing)}>
      {view.status === 'recorded'
        ? `Errors: ${describeErrorCoverage(view.value)}`
        : `Error record unavailable. ${view.reason}.`}
    </p>
  );
}

function StepsPanel({ side, label }: { side: StepsSide; label: string }) {
  const view = side.timeline.evidence;
  const errorView = side.errors?.evidence ?? null;
  const errors =
    errorView?.status === 'recorded' ? errorView.value.entries : [];

  if (view.status === 'unavailable') {
    return (
      <section {...stylex.props(styles.stack)} aria-label={`${label} steps`}>
        <SubHeading xstyle={styles.heading}>{label}</SubHeading>
        <p {...stylex.props(styles.missing)}>
          Steps unavailable. {view.reason}.
        </p>
      </section>
    );
  }

  const { steps, finalState } = view.value;
  const requests = side.requests ?? [];
  const placed = requests.map((request) => stepOfRequest(steps, request));
  const early = {
    errors: errors.filter((error) => error.step === null),
    requests: requests.filter((_, index) => placed[index] === -1),
  };
  const hasEarly = early.errors.length + early.requests.length > 0;

  return (
    <section {...stylex.props(styles.stack)} aria-label={`${label} steps`}>
      <SubHeading xstyle={styles.heading}>{label}</SubHeading>
      <ErrorCoverage side={side} />
      {side.requests === null ? (
        <p {...stylex.props(styles.missing)}>Request evidence unavailable.</p>
      ) : null}
      {steps.length === 0 ? (
        <p {...stylex.props(styles.text)}>No steps are configured.</p>
      ) : null}
      {steps.length === 0 && !hasEarly ? null : (
        <ol {...stylex.props(styles.steps)}>
          {hasEarly ? (
            <Group
              label={
                <span {...stylex.props(styles.caption)}>
                  Before the first step
                </span>
              }
            >
              <Attached {...early} />
            </Group>
          ) : null}
          {steps.map((step) => (
            <Group key={step.index} label={<StepLabel step={step} />}>
              <Attached
                errors={errors.filter((error) => error.step === step.index)}
                requests={requests.filter(
                  (_, index) => placed[index] === step.index,
                )}
              />
            </Group>
          ))}
        </ol>
      )}
      <StateHeading />
      {finalState.kind === 'unavailable' ? (
        <p {...stylex.props(styles.missing)}>{finalState.reason}.</p>
      ) : (
        <details {...stylex.props(styles.contained)}>
          <summary {...stylex.props(styles.summary)}>
            Accessibility tree after the last step
          </summary>
          <div
            {...stylex.props(styles.scroll)}
            role="region"
            aria-label={`${label} accessibility tree`}
            tabIndex={0}
          >
            <pre {...stylex.props(styles.tree)}>{finalState.tree}</pre>
          </div>
        </details>
      )}
    </section>
  );
}

export function Steps({
  base,
  candidate,
}: {
  base: StepsSide | null;
  candidate: StepsSide;
}) {
  return (
    <div {...stylex.props(styles.stack)}>
      <p {...stylex.props(styles.text)}>
        Each error sits under the step after which it was read. Each request
        sits under the last step that had started when the request began. A
        listed error or response status is not a check result.
      </p>
      <div {...stylex.props(styles.grid)}>
        {base === null ? null : <StepsPanel label="Before" side={base} />}
        <StepsPanel
          label={base === null ? 'Current capture' : 'After'}
          side={candidate}
        />
      </div>
    </div>
  );
}

// The report renders steps with Steps, which adds errors and requests.
export const TimelineSection: ViewerSection<'timeline'> = ({
  base,
  candidate,
}) => (
  <Steps
    base={base === null ? null : { timeline: base, errors: null, requests: [] }}
    candidate={{ timeline: candidate, errors: null, requests: [] }}
  />
);
