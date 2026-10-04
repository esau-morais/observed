import * as stylex from '@stylexjs/stylex';
import { createContext, use, useState, type ReactNode } from 'react';
import type {
  ChangeScope,
  CheckVerdict,
  Comparison,
  Journey,
  Side,
} from '../comparison-model';
import type { PerformanceMetric } from '../evidence-kinds/performance';
import { journeySection, type JourneySection } from '../report-sections';
import {
  describeObserved,
  describeRevision,
  shortSource,
} from '../provenance-text';
import {
  anchorLocation,
  conclusionLabels,
  conclusionTones,
  runTone,
  describeMeasure,
  executionLabels,
  headlineParts,
  resultCounts,
  sideOutcome,
  toneSymbols,
  verdictLabels,
  verdictTones,
  type Tone,
} from '../result-text';
import { statusWords } from '../status-words';
import { describeVisual, diffLegend } from '../visual-text';
import { AgentCopy } from './agent-copy';
import { ChangeScopeView } from './change-map';
import { fonts, geometry, media } from './constants.stylex';
import {
  Artifacts,
  ChangedRegions,
  EvidenceLink,
  RequestLedger,
  Screenshot,
  type Highlight,
} from './evidence';
import { HeadingLevel, SubHeading } from './heading';
import {
  outlineJourney,
  type Outline,
  type OutlineSection,
  type SectionKey,
  type SectionStatus,
} from './outline';
import { EvidenceSection } from './sections';
import { SamplePlot } from './sections/sample-plot';
import { Steps } from './sections/timeline';
import { ThemeControl, useTheme } from './theme';
import { colors } from './tokens.stylex';

const styles = stylex.create({
  canvas: {
    backgroundColor: colors.canvas,
    color: colors.text,
    fontFamily: fonts.sans,
    fontSize: '0.9375rem',
    lineHeight: 1.5,
    minHeight: '100dvh',
    overflowWrap: 'anywhere',
  },
  container: {
    marginInline: 'auto',
    maxWidth: geometry.workspace,
    paddingInline: {
      default: 20,
      [media.tablet]: 32,
      [media.desktop]: 48,
    },
    paddingBlock: 24,
  },
  masthead: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomStyle: 'solid',
    borderBottomWidth: 1,
    display: 'flex',
    gap: 16,
    justifyContent: 'space-between',
    paddingBottom: 16,
    marginBottom: 32,
  },
  brand: {
    alignItems: 'baseline',
    columnGap: 12,
    display: 'flex',
    flexWrap: 'wrap',
    minWidth: 0,
  },
  wordmark: { fontSize: '1.25rem', fontWeight: 500, letterSpacing: '-0.025em' },
  layout: {
    display: 'grid',
    columnGap: 48,
    rowGap: 32,
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      [media.desktop]: '16rem minmax(0, 1fr)',
    },
    gridTemplateRows: { default: 'auto', [media.desktop]: 'auto 1fr' },
  },
  wide: { display: { default: 'none', [media.desktop]: 'block' } },
  narrow: {
    borderBottomColor: colors.border,
    borderBottomStyle: 'solid',
    borderBottomWidth: 1,
    borderTopColor: colors.border,
    borderTopStyle: 'solid',
    borderTopWidth: 1,
    display: { default: 'block', [media.desktop]: 'none' },
  },
  verdictArea: {
    gridColumn: { default: 'auto', [media.desktop]: '2' },
    gridRow: { default: 'auto', [media.desktop]: '1' },
    minWidth: 0,
  },
  railArea: {
    alignSelf: 'start',
    gridColumn: { default: 'auto', [media.desktop]: '1' },
    gridRow: { default: 'auto', [media.desktop]: '1 / span 2' },
    minWidth: 0,
    position: { default: 'static', [media.desktop]: 'sticky' },
    top: 24,
  },
  bodyArea: {
    display: 'grid',
    gap: 40,
    gridColumn: { default: 'auto', [media.desktop]: '2' },
    gridRow: { default: 'auto', [media.desktop]: '2' },
    minWidth: 0,
  },
  // A change map takes the full width under the verdict; the index and the
  // journeys follow it.
  mapLayout: {
    gridTemplateRows: { default: 'auto', [media.desktop]: 'auto auto 1fr' },
  },
  mapVerdict: { gridColumn: { default: 'auto', [media.desktop]: '1 / -1' } },
  mapArea: {
    gridColumn: { default: 'auto', [media.desktop]: '1 / -1' },
    gridRow: { default: 'auto', [media.desktop]: '2' },
    minWidth: 0,
  },
  mapRest: { gridRow: { default: 'auto', [media.desktop]: '3' } },
  section: { display: 'grid', gap: 20, minWidth: 0 },
  stack: { display: 'grid', gap: 12, minWidth: 0 },
  verdictWord: {
    alignItems: 'baseline',
    display: 'flex',
    fontFamily: fonts.pixel,
    fontSize: { default: '2.5rem', [media.tablet]: '3rem' },
    fontWeight: 400,
    gap: 12,
    letterSpacing: 0,
    lineHeight: 1.1,
  },
  symbol: { fontFamily: fonts.sans, fontWeight: 500 },
  title: {
    fontSize: { default: '1.5rem', [media.tablet]: '2rem' },
    fontWeight: 500,
    letterSpacing: '-0.02em',
    lineHeight: 1.2,
    maxWidth: '40ch',
  },
  lead: { fontSize: '1.0625rem', maxWidth: '68ch' },
  values: {
    fontSize: '1.25rem',
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 500,
    lineHeight: 1.35,
    maxWidth: '68ch',
  },
  counts: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    listStyle: 'none',
    margin: 0,
    padding: 0,
  },
  revisions: {
    color: colors.textMuted,
    fontFamily: fonts.mono,
    fontSize: '0.8125rem',
  },
  notice: {
    backgroundColor: colors.unknownFill,
    borderRadius: geometry.radius,
    color: colors.unknown,
    display: 'grid',
    gap: 8,
    maxWidth: '68ch',
    padding: 16,
  },
  noticeTitle: { fontWeight: 500 },
  rail: { display: 'grid', gap: 16 },
  railGroup: { display: 'grid', gap: 4 },
  railTitle: {
    color: colors.textMuted,
    fontFamily: fonts.mono,
    fontSize: '0.75rem',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  railList: {
    display: 'grid',
    gap: { default: 4, [media.desktop]: 0 },
    gridTemplateColumns: {
      default: 'repeat(auto-fill, minmax(10rem, 1fr))',
      [media.desktop]: 'minmax(0, 1fr)',
    },
    listStyle: 'none',
    margin: 0,
    padding: 0,
  },
  railLink: {
    alignItems: 'center',
    overflowWrap: 'normal',
    borderRadius: 8,
    color: colors.text,
    columnGap: 8,
    display: 'grid',
    gridTemplateColumns: {
      default: '1.25rem minmax(0, 1fr)',
      [media.desktop]: '1.25rem minmax(0, 1fr) fit-content(45%)',
    },
    minHeight: geometry.target,
    paddingBlock: { default: 4, [media.desktop]: 0 },
    paddingInline: 8,
    textDecoration: 'none',
    backgroundColor: {
      default: 'transparent',
      [media.hover]: { default: 'transparent', ':hover': colors.surfaceMuted },
    },
    outlineColor: { default: colors.focus, [media.forcedColors]: 'Highlight' },
    outlineOffset: 0,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
  },
  railCount: {
    color: colors.textMuted,
    gridColumn: { default: '2', [media.desktop]: 'auto' },
    fontFamily: fonts.mono,
    fontSize: '0.75rem',
    fontVariantNumeric: 'tabular-nums',
    minWidth: 0,
    overflowWrap: 'anywhere',
    textAlign: { default: 'start', [media.desktop]: 'end' },
  },
  railSymbol: { fontWeight: 500, textAlign: 'center' },
  hidden: {
    clipPath: 'inset(50%)',
    height: 1,
    overflow: 'hidden',
    position: 'absolute',
    whiteSpace: 'nowrap',
    width: 1,
  },
  disclosures: {
    borderTopColor: colors.border,
    borderTopStyle: 'solid',
    borderTopWidth: 1,
    display: 'grid',
  },
  disclosure: {
    borderBottomColor: colors.border,
    borderBottomStyle: 'solid',
    borderBottomWidth: 1,
    scrollMarginTop: 16,
  },
  summary: {
    alignItems: 'center',
    cursor: 'pointer',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 12,
    minHeight: geometry.target,
    paddingBlock: 12,
    fontWeight: 500,
    outlineColor: { default: colors.focus, [media.forcedColors]: 'Highlight' },
    outlineOffset: 3,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
  },
  disclosureTitle: { display: 'inline', fontSize: '1.25rem', fontWeight: 500 },
  disclosureBody: { paddingBottom: 32, paddingTop: 8 },
  subheading: { fontSize: '1.125rem', fontWeight: 500, lineHeight: 1.35 },
  text: { color: colors.textSecondary, maxWidth: '68ch' },
  small: { color: colors.textMuted, fontSize: '0.8125rem' },
  mono: {
    fontFamily: fonts.mono,
    fontSize: '0.8125rem',
    overflowWrap: 'anywhere',
  },
  grid: {
    display: 'grid',
    alignItems: 'start',
    gap: 24,
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      [media.desktop]: 'repeat(2, minmax(0, 1fr))',
    },
  },
  panel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: geometry.radius,
    borderStyle: 'solid',
    borderWidth: 1,
    display: 'grid',
    gap: 16,
    minWidth: 0,
    padding: { default: 16, [media.tablet]: 24 },
  },
  definition: { display: 'grid', gap: 12, minWidth: 0 },
  definitionRow: { display: 'grid', gap: 4, minWidth: 0 },
  term: { color: colors.textMuted, fontSize: '0.8125rem' },
  badge: {
    alignItems: 'center',
    borderRadius: 4,
    display: 'inline-flex',
    fontSize: '0.8125rem',
    fontWeight: 500,
    gap: 6,
    justifySelf: 'start',
    paddingBlock: 2,
    paddingInline: 8,
    whiteSpace: 'nowrap',
  },
  neutral: {
    backgroundColor: colors.surfaceMuted,
    color: colors.textSecondary,
  },
  checked: { backgroundColor: colors.checkedFill, color: colors.checked },
  changed: { backgroundColor: colors.changedFill, color: colors.changed },
  regression: {
    backgroundColor: colors.regressionFill,
    color: colors.regression,
  },
  unknown: { backgroundColor: colors.unknownFill, color: colors.unknown },
  inkRegression: { color: colors.regression },
  inkUnknown: { color: colors.unknown },
  inkChecked: { color: colors.checked },
  inkChanged: { color: colors.changed },
  inkNeutral: { color: colors.textSecondary },
  inkMuted: { color: colors.textMuted },
  list: { display: 'grid', gap: 8, paddingInlineStart: 20, marginBlock: 0 },
  checks: {
    display: 'grid',
    gap: 16,
    listStyle: 'none',
    marginBlock: 0,
    maxWidth: '68ch',
    paddingInlineStart: 0,
  },
  check: { display: 'grid', gap: 4, minWidth: 0 },
  checkHeader: {
    alignItems: 'center',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 12,
  },
  checkName: { fontWeight: 500 },
  journeyTitle: {
    fontSize: { default: '1.25rem', [media.tablet]: '1.5rem' },
    fontWeight: 500,
    letterSpacing: '-0.01em',
    lineHeight: 1.3,
  },
  nav: { display: 'flex', flexWrap: 'wrap', columnGap: 24, rowGap: 12 },
  toggle: {
    alignItems: 'center',
    cursor: 'pointer',
    display: 'inline-flex',
    gap: 8,
    minHeight: geometry.target,
  },
  checkbox: {
    accentColor: colors.focus,
    height: 20,
    margin: 0,
    width: 20,
    outlineColor: { default: colors.focus, [media.forcedColors]: 'Highlight' },
    outlineOffset: 3,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
  },
  skip: {
    backgroundColor: colors.surface,
    color: colors.text,
    left: 20,
    padding: 12,
    position: 'absolute',
    top: { default: '-200px', ':focus': '12px' },
    zIndex: 1,
    outlineColor: { default: colors.focus, [media.forcedColors]: 'Highlight' },
    outlineOffset: 3,
    outlineStyle: 'solid',
    outlineWidth: 2,
  },
  footer: {
    borderTopColor: colors.border,
    borderTopStyle: 'solid',
    borderTopWidth: 1,
    color: colors.textMuted,
    fontSize: '0.8125rem',
    marginTop: 48,
    paddingTop: 20,
  },
});

const toneInk = {
  regression: styles.inkRegression,
  unknown: styles.inkUnknown,
  checked: styles.inkChecked,
  neutral: styles.inkNeutral,
} satisfies Record<Tone, stylex.StaticStyles>;

const sectionInk = {
  failed: styles.inkRegression,
  unknown: styles.inkUnknown,
  changed: styles.inkChanged,
  passed: styles.inkChecked,
  neutral: styles.inkMuted,
} satisfies Record<SectionStatus, stylex.StaticStyles>;

const sectionTones = {
  failed: 'regression',
  unknown: 'unknown',
  changed: 'changed',
  passed: 'checked',
  neutral: 'neutral',
} as const satisfies Record<SectionStatus, Tone | 'changed'>;

const sectionSymbols = {
  failed: toneSymbols.regression,
  unknown: toneSymbols.unknown,
  changed: 'Δ',
  passed: toneSymbols.checked,
  neutral: '·',
} satisfies Record<SectionStatus, string>;

const sectionStatusLabels = {
  failed: statusWords.failed.word,
  unknown: statusWords.unknown.word,
  changed: statusWords.changed.word,
  passed: statusWords.passed.word,
  neutral: '',
} satisfies Record<SectionStatus, string>;

function sectionId(prefix: string, key: SectionKey): string {
  return key === 'capture' ||
    key === 'checks' ||
    key === 'screenshots' ||
    key === 'requests' ||
    key === 'provenance' ||
    key === 'limits'
    ? `${prefix}${key}`
    : `${prefix}evidence-${key}`;
}

function Field({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div {...stylex.props(styles.definitionRow)}>
      <dt {...stylex.props(styles.term)}>{label}</dt>
      <dd {...stylex.props(mono && styles.mono)}>{children}</dd>
    </div>
  );
}

function VerdictChip({ verdict }: { verdict: CheckVerdict['verdict'] }) {
  const tone = verdictTones[verdict];

  return (
    <span {...stylex.props(styles.badge, styles[tone])}>
      <span aria-hidden="true">{toneSymbols[tone]}</span>
      {verdictLabels[verdict]}
    </span>
  );
}

function SectionStatusLine({ section }: { section: OutlineSection }) {
  const label = sectionStatusLabels[section.status];

  return (
    <>
      {label === '' ? null : (
        <span
          {...stylex.props(styles.badge, styles[sectionTones[section.status]])}
        >
          <span aria-hidden="true">{sectionSymbols[section.status]}</span>
          {label}
        </span>
      )}
      <span {...stylex.props(styles.railCount)}>{section.count}</span>
    </>
  );
}

// Lets a check's location read the run's change scope, which places it from
// the repository root, without passing the scope through every section.
const ChangeScopeContext = createContext<ChangeScope | undefined>(undefined);

function Location({
  journey,
  check,
}: {
  journey: Journey;
  check: CheckVerdict;
}) {
  const location = anchorLocation(journey, check, use(ChangeScopeContext));

  return location === null ? null : (
    <p {...stylex.props(styles.small)}>
      {location.words}{' '}
      <span {...stylex.props(styles.mono)}>{location.place}</span>
    </p>
  );
}

function Measured({
  check,
  shown,
  mode,
}: {
  check: CheckVerdict;
  shown: readonly string[];
  mode: Comparison['mode'];
}) {
  const measure =
    check.measure === undefined ? null : describeMeasure(check.measure, mode);

  return measure === null || shown.includes(measure) ? null : (
    <p {...stylex.props(styles.mono)}>{measure}</p>
  );
}

// Check rows shown above the evidence they read. Text the verdict block
// already shows is left out.
function SectionChecks({
  checks,
  journey,
  shown,
  mode,
}: {
  checks: readonly CheckVerdict[];
  journey: Journey;
  shown: readonly string[];
  mode: Comparison['mode'];
}) {
  if (checks.length === 0) {
    return null;
  }

  return (
    <ul {...stylex.props(styles.checks)}>
      {checks.map((check) => (
        <li key={check.id} {...stylex.props(styles.check)}>
          <div {...stylex.props(styles.checkHeader)}>
            <VerdictChip verdict={check.verdict} />
            <span {...stylex.props(styles.checkName)}>{check.name}</span>
          </div>
          <Measured check={check} shown={shown} mode={mode} />
          <Location journey={journey} check={check} />
          {shown.includes(check.detail) ? null : (
            <p {...stylex.props(styles.text)}>{check.detail}</p>
          )}
          {shown.includes(check.detail) &&
          check.detail.endsWith(` ${check.expectation}`) ? null : (
            <p {...stylex.props(styles.small)}>
              Expectation: {check.expectation}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function ChecksList({
  journey,
  outline,
  mode,
  prefix,
}: {
  journey: Journey;
  outline: Outline;
  mode: Comparison['mode'];
  prefix: string;
}) {
  if (journey.checks.length === 0) {
    return (
      <p {...stylex.props(styles.text)}>
        No named check is configured, so no behavior was checked. The captures
        show the application only.
      </p>
    );
  }

  const titles = new Map(
    outline.sections.map((section) => [section.key, section.title]),
  );

  return (
    <ul {...stylex.props(styles.checks)}>
      {journey.checks.map((check) => {
        const placed = outline.placement.get(check.id);
        const authority =
          (
            journey.candidate.checks.find((item) => item.id === check.id) ??
            journey.base.checks.find((item) => item.id === check.id)
          )?.authority ?? null;

        return (
          <li key={check.id} {...stylex.props(styles.check)}>
            <div {...stylex.props(styles.checkHeader)}>
              <VerdictChip verdict={check.verdict} />
              <span {...stylex.props(styles.checkName)}>{check.name}</span>
            </div>
            <p {...stylex.props(styles.text)}>Scope: {check.scope}</p>
            <Location journey={journey} check={check} />
            {placed === undefined ? (
              <p {...stylex.props(styles.text)}>{check.detail}</p>
            ) : (
              <p {...stylex.props(styles.small)}>
                Evidence:{' '}
                <EvidenceLink href={`#${sectionId(prefix, placed)}`}>
                  {titles.get(placed) ?? placed}
                </EvidenceLink>
              </p>
            )}
            <p {...stylex.props(styles.small)}>
              {mode === 'comparison'
                ? `Before: ${sideOutcome(journey.base, check.id)} · After: ${sideOutcome(journey.candidate, check.id)}`
                : `Result: ${sideOutcome(journey.candidate, check.id)}`}
              {authority === null ? '' : ` · ${authority}`} ·{' '}
              <span {...stylex.props(styles.mono)}>{check.id}</span>
            </p>
          </li>
        );
      })}
    </ul>
  );
}

function CaptureDetails({ side }: { side: Side }) {
  if (side.capture === null) {
    return <p {...stylex.props(styles.text)}>Capture metadata unavailable.</p>;
  }

  const capture = side.capture.manifest;

  return (
    <details>
      <summary {...stylex.props(styles.summary)}>
        Observed, producer, conditions, recipe and source files
      </summary>
      <dl {...stylex.props(styles.definition)}>
        <Field label="Application">{capture.application}</Field>
        <Field label="Capture ID" mono>
          {capture.id}
        </Field>
        <Field label="Manifest SHA-256" mono>
          {side.capture.sha256}
        </Field>
        <Field label="Observed" mono>
          {describeObserved(capture.observed)}
        </Field>
        <Field label="Producer">
          {capture.producer.name} · {capture.producer.version}
        </Field>
        <Field label="Source revision" mono>
          {describeRevision(capture.source.revision)}
        </Field>
        <Field label="Recipe">{capture.recipe.id}</Field>
        <Field label="Recipe SHA-256" mono>
          {capture.recipe.sha256}
        </Field>
        <Field label="Source entry" mono>
          {capture.source.entry}
        </Field>
        {capture.execution.kind === 'failed' ? (
          <Field label="Capture failure">
            {capture.execution.category}: {capture.execution.reason}
          </Field>
        ) : null}
        {capture.conditions.kind === 'unavailable' ? (
          <Field label="Conditions unavailable">
            {capture.conditions.reason}
          </Field>
        ) : (
          <>
            <Field label="Browser">{capture.conditions.value.browser}</Field>
            <Field label="Platform">{capture.conditions.value.platform}</Field>
            <Field label="Bun">{capture.conditions.value.bun}</Field>
            <Field label="Viewport">
              {capture.conditions.value.viewport.width} ×{' '}
              {capture.conditions.value.viewport.height} CSS px · scale{' '}
              {capture.conditions.value.viewport.scale}
            </Field>
            <Field label="Color scheme">
              {capture.conditions.value.colorScheme}
            </Field>
            <Field label="Locale and timezone">
              {capture.conditions.value.locale} ·{' '}
              {capture.conditions.value.timezone}
            </Field>
            <Field label="Startup inputs SHA-256" mono>
              {capture.conditions.value.inputsHash}
            </Field>
            <Field label="Dependency files SHA-256" mono>
              {capture.conditions.value.dependenciesHash ??
                'No dependency files selected'}
            </Field>
          </>
        )}
        <Field label="Source files">
          <ul {...stylex.props(styles.list, styles.mono)}>
            {capture.source.files.map((file) => (
              <li key={file.path}>
                {file.path}
                <br />
                SHA-256: {file.sha256}
              </li>
            ))}
          </ul>
        </Field>
      </dl>
    </details>
  );
}

function Identity({ side, label }: { side: Side; label: string }) {
  const capture = side.capture?.manifest ?? null;

  return (
    <section
      {...stylex.props(styles.panel)}
      aria-label={`${label} selected capture`}
    >
      <SubHeading xstyle={styles.subheading}>{label}</SubHeading>
      <p>{capture?.label ?? 'Capture unavailable'}</p>
      <p {...stylex.props(styles.small)}>
        Capture: {executionLabels[side.execution]}
      </p>
      <dl {...stylex.props(styles.definition)}>
        <Field label="Full snapshot SHA-256" mono>
          {capture?.source.sha256 ?? 'Unavailable'}
        </Field>
        <Field label="Capture started (UTC)" mono>
          {capture?.startedAt ?? 'Unavailable'}
        </Field>
        <Field label="Capture finished (UTC)" mono>
          {capture?.finishedAt ?? 'Unavailable'}
        </Field>
      </dl>
      <CaptureDetails side={side} />
      <details>
        <summary {...stylex.props(styles.summary)}>
          Original artifacts ({side.artifacts.length})
        </summary>
        <Artifacts side={side} label={label} />
      </details>
    </section>
  );
}

function Availability({ comparison }: { comparison: Journey['comparison'] }) {
  if (comparison.kind === 'preview') {
    return (
      <p {...stylex.props(styles.text)}>
        Single capture. No comparison requested.
      </p>
    );
  }

  if (comparison.kind === 'unavailable') {
    return (
      <div {...stylex.props(styles.stack)}>
        <p {...stylex.props(styles.text)}>Comparison unavailable:</p>
        <ul {...stylex.props(styles.list)}>
          {comparison.reasons.map((reason, index) => (
            <li key={index}>{reason}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <p {...stylex.props(styles.text)}>
      Comparison available. {comparison.basis} Request count difference
      (candidate minus base): {comparison.requestDifference}.
    </p>
  );
}

function Disclosure({
  id,
  section,
  open,
  level,
  children,
}: {
  id: string;
  section: OutlineSection;
  open: boolean;
  level: 2 | 3;
  children: ReactNode;
}) {
  const Heading = level === 2 ? 'h2' : 'h3';

  return (
    <details id={id} open={open} {...stylex.props(styles.disclosure)}>
      <summary {...stylex.props(styles.summary)}>
        <Heading {...stylex.props(styles.disclosureTitle)}>
          {section.title}
        </Heading>
        <SectionStatusLine section={section} />
      </summary>
      <div {...stylex.props(styles.section, styles.disclosureBody)}>
        <HeadingLevel value={level === 2 ? 3 : 4}>{children}</HeadingLevel>
      </div>
    </details>
  );
}

const failureFiles = ['transcript', 'failure'];

function CaptureFailure({
  journey,
  outline,
  mode,
}: {
  journey: Journey;
  outline: Outline;
  mode: Comparison['mode'];
}) {
  const groups: { labels: string[]; side: Side }[] = [];

  for (const { side, label } of journeySides(journey, mode)) {
    if (side.execution === 'complete') {
      continue;
    }

    const same = groups.find(
      (group) =>
        group.side.execution === side.execution &&
        group.side.unresolved.join('\n') === side.unresolved.join('\n'),
    );

    if (same === undefined) {
      groups.push({ labels: [label], side });
    } else {
      same.labels.push(label);
    }
  }

  const [shared] = groups;
  const both = groups.length === 1 && shared?.labels.length === 2;

  return (
    <>
      {groups.map(({ labels, side }) => {
        const files = side.artifacts.flatMap((artifact) =>
          artifact.integrity === 'verified' &&
          failureFiles.includes(artifact.id)
            ? [artifact]
            : [],
        );
        const name = labels.join(' and ');

        return (
          <section
            key={name}
            aria-label={`${name}: ${executionLabels[side.execution]}`}
            {...stylex.props(styles.notice)}
          >
            <p {...stylex.props(styles.noticeTitle)}>{name}</p>
            <ul {...stylex.props(styles.list)}>
              {side.unresolved.map((reason, index) => (
                <li key={index}>{reason}</li>
              ))}
            </ul>
            {files.length === 0 ? null : (
              <p {...stylex.props(styles.small)}>
                Full output:{' '}
                {files.map((artifact, index) => (
                  <span key={artifact.id}>
                    {index === 0 ? null : ' · '}
                    <EvidenceLink href={artifact.path}>
                      {artifact.path.split('/').at(-1)}
                    </EvidenceLink>
                  </span>
                ))}
              </p>
            )}
          </section>
        );
      })}
      {both && shared.side.execution === 'capture-failed' ? (
        <p {...stylex.props(styles.text)}>
          The base capture failed with the same error. Both captures ran the
          setup and journey from the candidate&apos;s observed.json.
        </p>
      ) : null}
      {outline.unrecorded.length === 0 ? null : (
        <p {...stylex.props(styles.small)}>
          No evidence recorded for {outline.unrecorded.join(', ')}.
        </p>
      )}
    </>
  );
}

function journeySides(journey: Journey, mode: Comparison['mode']) {
  return mode === 'preview'
    ? [{ side: journey.candidate, label: 'Current capture' }]
    : [
        { side: journey.base, label: 'Before' },
        { side: journey.candidate, label: 'After' },
      ];
}

type Unresolved = { journey: string; side: string | null; reason: string };

function journeyUnresolved(
  journey: Journey,
  mode: Comparison['mode'],
): Unresolved[] {
  const sides = journeySides(journey, mode);
  const sideIssues = sides.flatMap(({ side }) => side.unresolved);

  return [
    ...sides.flatMap(({ side, label }) =>
      side.unresolved.map((reason) => ({
        journey: journey.title,
        side: label,
        reason,
      })),
    ),
    ...(journey.comparison.kind === 'unavailable'
      ? journey.comparison.reasons
          .filter(
            (reason) => !sideIssues.some((issue) => reason.endsWith(issue)),
          )
          .map((reason) => ({ journey: journey.title, side: null, reason }))
      : []),
  ];
}

function groupUnresolved(result: Comparison): string[] {
  const groups = new Map<string, Map<string, string[]>>();

  for (const journey of result.journeys) {
    for (const entry of journeyUnresolved(journey, result.mode)) {
      const journeys = groups.get(entry.reason) ?? new Map<string, string[]>();
      const sides = journeys.get(entry.journey) ?? [];

      if (entry.side !== null && !sides.includes(entry.side)) {
        sides.push(entry.side);
      }

      journeys.set(entry.journey, sides);
      groups.set(entry.reason, journeys);
    }
  }

  const total = result.journeys.length;

  return [...groups].map(([reason, journeys]) => {
    const sideSets = [...journeys.values()].map((sides) => sides.join(' and '));
    const [sides = ''] = sideSets;
    const uniform = sideSets.every((set) => set === sides);
    const scope =
      uniform && journeys.size === total
        ? [total === 1 ? '' : 'All journeys', sides]
        : [...journeys].map(([journey, set]) =>
            [total === 1 ? '' : journey, set.join(' and ')]
              .filter((part) => part !== '')
              .join(' · '),
          );
    const named = scope
      .filter((part) => part !== '')
      .join(uniform ? ', ' : '; ');

    return named === '' ? reason : `${named}: ${reason}`;
  });
}

function Screens({
  journey,
  mode,
  prefix,
}: {
  journey: Journey;
  mode: Comparison['mode'];
  prefix: string;
}) {
  const sides = journeySides(journey, mode);
  const [highlighted, setHighlighted] = useState(false);
  const visual =
    journey.comparison.kind === 'available' ? journey.comparison.visual : null;
  const highlight: Highlight | null =
    highlighted && visual?.kind === 'changed' ? visual : null;

  return (
    <>
      {visual === null ? null : (
        <div {...stylex.props(styles.stack)}>
          <p {...stylex.props(styles.text)}>
            {describeVisual(visual)}
            {visual.kind === 'changed' || visual.kind === 'size-differs'
              ? ' An observation, not a check.'
              : ''}
          </p>
          {visual.kind === 'changed' ? (
            <>
              <div {...stylex.props(styles.nav)}>
                <label {...stylex.props(styles.toggle)}>
                  <input
                    type="checkbox"
                    checked={highlighted}
                    onChange={(event) =>
                      setHighlighted(event.currentTarget.checked)
                    }
                    {...stylex.props(styles.checkbox)}
                  />
                  Highlight changed regions
                </label>
                <span {...stylex.props(styles.toggle)}>
                  <EvidenceLink href={visual.diff.path}>
                    Open pixel difference image
                  </EvidenceLink>
                </span>
              </div>
              <p {...stylex.props(styles.small)}>{diffLegend}</p>
            </>
          ) : null}
        </div>
      )}
      <div {...stylex.props(mode === 'comparison' && styles.grid)}>
        {sides.map(({ side, label }) => (
          <Screenshot
            key={label}
            side={side}
            label={label}
            highlight={highlight}
          />
        ))}
      </div>
      {visual?.kind === 'changed' &&
      journey.base.screenshot !== null &&
      journey.candidate.screenshot !== null ? (
        <ChangedRegions
          visual={visual}
          before={journey.base.screenshot}
          after={journey.candidate.screenshot}
          id={`${prefix}changed-regions`}
        />
      ) : null}
    </>
  );
}

function PerformancePlots({
  journey,
  section,
}: {
  journey: Journey;
  section: JourneySection<'performance'>;
}) {
  const recipe = journey.candidate.recipe ?? journey.base.recipe;
  const budgets = new Map<PerformanceMetric, number | null>();

  for (const check of recipe?.checks ?? []) {
    if (check.kind === 'performance' && !budgets.has(check.metric)) {
      budgets.set(check.metric, check.max ?? null);
    }
  }

  if (budgets.size === 0) {
    budgets.set('lcp', null);
  }

  return [...budgets].map(([metric, budget]) => (
    <SamplePlot
      key={metric}
      metric={metric}
      budget={budget}
      base={section.input.base?.evidence ?? null}
      candidate={section.input.candidate.evidence}
    />
  ));
}

function requestsOf(side: Side) {
  return side.execution === 'complete' ? side.observations.requests : null;
}

function StepsBody({
  journey,
  timeline,
  errors,
}: {
  journey: Journey;
  timeline: JourneySection<'timeline'>;
  errors: JourneySection<'browser-errors'> | null;
}) {
  const { base, candidate } = timeline.input;

  return (
    <Steps
      comparing={journey.comparison.kind !== 'preview'}
      base={
        base === null
          ? null
          : {
              timeline: base,
              errors: errors?.input.base ?? null,
              requests: requestsOf(journey.base),
            }
      }
      candidate={{
        timeline: candidate,
        errors: errors?.input.candidate ?? null,
        requests: requestsOf(journey.candidate),
      }}
    />
  );
}

function SectionBody({
  section,
  journey,
  outline,
  mode,
  evaluatedAt,
  shown,
  prefix,
}: {
  section: OutlineSection;
  journey: Journey;
  outline: Outline;
  mode: Comparison['mode'];
  evaluatedAt: string;
  shown: readonly string[];
  prefix: string;
}) {
  const sides = journeySides(journey, mode);

  switch (section.key) {
    case 'capture':
      return <CaptureFailure journey={journey} outline={outline} mode={mode} />;
    case 'checks':
      return (
        <ChecksList
          journey={journey}
          outline={outline}
          mode={mode}
          prefix={prefix}
        />
      );
    case 'screenshots':
      return <Screens journey={journey} mode={mode} prefix={prefix} />;
    case 'requests':
      return (
        <>
          <SectionChecks
            checks={section.checks}
            journey={journey}
            shown={shown}
            mode={mode}
          />
          <p {...stylex.props(styles.text)}>
            Recorded by the browser. A response status is not a check result.
          </p>
          <div {...stylex.props(styles.grid)}>
            {sides.map(({ side, label }) => (
              <RequestLedger key={label} side={side} label={label} />
            ))}
          </div>
        </>
      );
    case 'provenance':
      return (
        <>
          <p {...stylex.props(styles.small)}>
            Evaluated at <time dateTime={evaluatedAt}>{evaluatedAt}</time>.
            Integrity describes availability and hash verification, not
            application correctness.
          </p>
          <Availability comparison={journey.comparison} />
          <div {...stylex.props(styles.grid)}>
            {sides.map(({ side, label }) => (
              <Identity key={label} side={side} label={label} />
            ))}
          </div>
        </>
      );
    case 'limits':
      return (
        <ul {...stylex.props(styles.list)}>
          {journey.limitations.map((limitation, item) => (
            <li key={item}>{limitation}</li>
          ))}
        </ul>
      );
    case 'text':
    case 'react':
    case 'accessibility':
    case 'performance':
    case 'timeline':
    case 'browser-errors':
    case 'api':
    case 'playwright':
    case 'coverage':
      return (
        <>
          <SectionChecks
            checks={section.checks}
            journey={journey}
            shown={shown}
            mode={mode}
          />
          <EvidenceBody section={section} journey={journey} />
        </>
      );
  }
}

function EvidenceBody({
  section,
  journey,
}: {
  section: OutlineSection;
  journey: Journey;
}) {
  const timeline =
    section.key === 'timeline' ? journeySection(journey, 'timeline') : null;
  const performance =
    section.key === 'performance'
      ? journeySection(journey, 'performance')
      : null;

  if (timeline !== null) {
    return (
      <StepsBody
        journey={journey}
        timeline={timeline}
        errors={journeySection(journey, 'browser-errors')}
      />
    );
  }

  return section.evidence === null ? null : (
    <>
      {performance === null ? null : (
        <PerformancePlots journey={journey} section={performance} />
      )}
      <EvidenceSection section={section.evidence} />
    </>
  );
}

function openSection(id: string) {
  const target = document.getElementById(id);

  if (target instanceof HTMLDetailsElement) {
    target.open = true;
  }
}

function railSummary(outlines: readonly Outline[]): string {
  const sections = outlines.flatMap((outline) => outline.sections);
  const failed = sections.filter((section) => section.status === 'failed');
  const unknown = sections.filter((section) => section.status === 'unknown');
  const changed = sections.filter((section) => section.status === 'changed');

  return [
    `${sections.length} sections`,
    ...(failed.length === 0 ? [] : [`${failed.length} failed`]),
    ...(unknown.length === 0 ? [] : [`${unknown.length} unknown`]),
    ...(changed.length === 0 ? [] : [`${changed.length} changed`]),
  ].join(' · ');
}

function Rail({
  outlines,
  journeys,
}: {
  outlines: readonly Outline[];
  journeys: readonly Journey[];
}) {
  const multiple = journeys.length > 1;

  return (
    <nav aria-label="Report sections" {...stylex.props(styles.rail)}>
      {outlines.map((outline, index) => {
        const prefix = multiple ? `journey-${index + 1}-` : '';

        return (
          <div key={index} {...stylex.props(styles.railGroup)}>
            <p {...stylex.props(styles.railTitle)}>
              {multiple ? journeys[index]?.title : 'Sections'}
            </p>
            <ul {...stylex.props(styles.railList)}>
              {outline.sections.map((section) => {
                const id = sectionId(prefix, section.key);
                const label = sectionStatusLabels[section.status];

                return (
                  <li key={section.key}>
                    <a
                      href={`#${id}`}
                      onClick={() => openSection(id)}
                      {...stylex.props(styles.railLink)}
                    >
                      <span
                        aria-hidden="true"
                        {...stylex.props(
                          styles.railSymbol,
                          sectionInk[section.status],
                        )}
                      >
                        {sectionSymbols[section.status]}
                      </span>
                      <span>
                        {section.title}
                        {label === '' ? null : (
                          <span {...stylex.props(styles.hidden)}>
                            , {label.toLowerCase()}
                          </span>
                        )}
                      </span>
                      <span {...stylex.props(styles.railCount)}>
                        {section.count}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function JourneyView({
  journey,
  outline,
  mode,
  evaluatedAt,
  shown,
  index,
  multiple,
}: {
  journey: Journey;
  outline: Outline;
  mode: Comparison['mode'];
  evaluatedAt: string;
  shown: readonly string[];
  index: number;
  multiple: boolean;
}) {
  const prefix = multiple ? `journey-${index + 1}-` : '';
  const level = multiple ? 3 : 2;
  const tone = conclusionTones[journey.conclusion.kind];
  const titleId = `journey-${index + 1}-title`;

  return (
    <section
      {...stylex.props(styles.section)}
      {...(multiple
        ? { 'aria-labelledby': titleId }
        : {
            'aria-label':
              mode === 'preview' ? 'Application capture' : 'Evidence',
          })}
    >
      {multiple ? (
        <div {...stylex.props(styles.stack)}>
          <h2 id={titleId} {...stylex.props(styles.journeyTitle)}>
            {journey.title}
          </h2>
          <span {...stylex.props(styles.badge, styles[tone])}>
            <span aria-hidden="true">{toneSymbols[tone]}</span>
            {conclusionLabels[journey.conclusion.kind]}
          </span>
          <p {...stylex.props(styles.text)}>{journey.conclusion.text}</p>
        </div>
      ) : null}
      <div {...stylex.props(styles.disclosures)}>
        {outline.sections.map((section) => (
          <Disclosure
            key={section.key}
            id={sectionId(prefix, section.key)}
            section={section}
            open={section.open}
            level={level}
          >
            <SectionBody
              section={section}
              journey={journey}
              outline={outline}
              mode={mode}
              evaluatedAt={evaluatedAt}
              shown={shown}
              prefix={prefix}
            />
          </Disclosure>
        ))}
      </div>
    </section>
  );
}

function Verdict({ result }: { result: Comparison }) {
  const tone = runTone(result);
  const multiple = result.journeys.length > 1;
  const { label, subject, restated } = headlineParts(result);
  const unresolved = groupUnresolved(result);
  const [first] = result.journeys;
  const source = (side: Side) =>
    side.capture === null
      ? 'unavailable'
      : shortSource(side.capture.manifest.source);

  return (
    <section {...stylex.props(styles.stack)} aria-labelledby="report-title">
      <p {...stylex.props(styles.verdictWord, toneInk[tone])}>
        <span aria-hidden="true" {...stylex.props(styles.symbol)}>
          {toneSymbols[tone]}
        </span>
        {label}
      </p>
      <h1 id="report-title" {...stylex.props(styles.title)}>
        {result.title}
      </h1>
      {subject === result.title || restated ? null : (
        <p {...stylex.props(styles.values)}>{subject}</p>
      )}
      <p {...stylex.props(styles.lead)}>{result.conclusion.text}</p>
      <p {...stylex.props(styles.text)}>
        {result.summary.total === 0
          ? 'No named check is configured, so no behavior was checked.'
          : resultCounts(result)}
      </p>
      {first === undefined || multiple ? null : (
        <p {...stylex.props(styles.revisions)}>
          {result.mode === 'preview'
            ? `Capture ${source(first.candidate)}`
            : `Base ${source(first.base)} → Candidate ${source(first.candidate)}`}
        </p>
      )}
      {unresolved.length === 0 ? null : (
        <div {...stylex.props(styles.notice)}>
          <p {...stylex.props(styles.noticeTitle)}>
            <span aria-hidden="true">{toneSymbols.unknown}</span> Not covered by
            a check
          </p>
          <ul {...stylex.props(styles.list)}>
            {unresolved.map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
      <AgentCopy result={result} />
    </section>
  );
}

export function ComparisonReport({ result }: { result: Comparison }) {
  const theme = useTheme();
  const multiple = result.journeys.length > 1;
  const outlines = result.journeys.map(outlineJourney);
  const scope =
    result.mode === 'comparison' && result.changeScope.kind === 'recorded'
      ? result.changeScope
      : null;
  // The map leads only when it has a captured file to draw; otherwise the
  // journeys' evidence explains the verdict and the files follow it.
  const mapFirst =
    scope !== null &&
    result.changeMap.kind === 'recorded' &&
    scope.files.some((file) => file.captured);

  return (
    <div {...stylex.props(styles.canvas)}>
      <a href="#report" {...stylex.props(styles.skip)}>
        Skip to report
      </a>
      <div {...stylex.props(styles.container)}>
        <header {...stylex.props(styles.masthead)}>
          <span {...stylex.props(styles.brand)}>
            <span {...stylex.props(styles.wordmark)}>observed</span>
            <span {...stylex.props(styles.small)}>
              {result.mode === 'preview'
                ? 'Application preview'
                : 'Application comparison'}
            </span>
          </span>
          <ThemeControl {...theme} />
        </header>
        <ChangeScopeContext value={result.changeScope}>
          <main
            id="report"
            tabIndex={-1}
            {...stylex.props(styles.layout, mapFirst && styles.mapLayout)}
          >
            <div
              {...stylex.props(
                styles.verdictArea,
                mapFirst && styles.mapVerdict,
              )}
            >
              <Verdict result={result} />
            </div>
            {mapFirst && scope !== null ? (
              <div {...stylex.props(styles.mapArea)}>
                <ChangeScopeView result={result} scope={scope} />
              </div>
            ) : null}
            <div {...stylex.props(styles.railArea, mapFirst && styles.mapRest)}>
              <div {...stylex.props(styles.wide)}>
                <Rail outlines={outlines} journeys={result.journeys} />
              </div>
              {/* Phones show the index collapsed so the lead evidence stays on
            the first screen. */}
              <details {...stylex.props(styles.narrow)}>
                <summary {...stylex.props(styles.summary)}>
                  Sections
                  <span {...stylex.props(styles.railCount)}>
                    {railSummary(outlines)}
                  </span>
                </summary>
                <Rail outlines={outlines} journeys={result.journeys} />
              </details>
            </div>
            <div {...stylex.props(styles.bodyArea, mapFirst && styles.mapRest)}>
              {result.journeys.map((journey, index) => {
                const outline = outlines[index];

                return outline === undefined ? null : (
                  <JourneyView
                    key={index}
                    journey={journey}
                    outline={outline}
                    mode={result.mode}
                    evaluatedAt={result.evaluatedAt}
                    shown={[
                      result.conclusion.text,
                      headlineParts(result).subject,
                    ]}
                    index={index}
                    multiple={multiple}
                  />
                );
              })}
              {!mapFirst && scope !== null ? (
                <ChangeScopeView result={result} scope={scope} />
              ) : null}
              <nav aria-label="Report files" {...stylex.props(styles.nav)}>
                <EvidenceLink href="./report.md">Markdown report</EvidenceLink>
                <EvidenceLink href="./result.json">Result JSON</EvidenceLink>
              </nav>
            </div>
          </main>
        </ChangeScopeContext>
        <footer {...stylex.props(styles.footer)}>
          Captured evidence · Select a screenshot to open it at full size.
        </footer>
      </div>
    </div>
  );
}

export function ReportState({
  kind,
  detail,
}: {
  kind: 'loading' | 'error';
  detail?: string;
}) {
  useTheme();

  return (
    <div {...stylex.props(styles.canvas)}>
      <main {...stylex.props(styles.container, styles.stack)}>
        <p {...stylex.props(styles.wordmark)}>observed</p>
        <h1 {...stylex.props(styles.title)}>
          {kind === 'loading'
            ? 'Loading comparison'
            : 'Comparison could not be loaded'}
        </h1>
        <p role="status" {...stylex.props(styles.text)}>
          {kind === 'loading'
            ? 'Reading the saved result.'
            : 'No comparison result is available to display. Reload the page, or open the evidence bundle with bun run view.'}
        </p>
        {detail === undefined ? null : (
          <p {...stylex.props(styles.mono)}>{detail}</p>
        )}
      </main>
    </div>
  );
}
