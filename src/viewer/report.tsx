import * as stylex from '@stylexjs/stylex';
import { useState, type ReactNode } from 'react';
import type {
  Check,
  CheckVerdict,
  Comparison,
  Journey,
  Side,
} from '../comparison-model';
import { evidenceKinds } from '../evidence-kinds';
import { journeySections } from '../report-sections';
import { fonts, geometry, media } from './constants.stylex';
import {
  Artifacts,
  ChangedRegions,
  EvidenceLink,
  RequestLedger,
  Screenshot,
  type Highlight,
} from './evidence';
import { describeObserved, describeRevision } from '../provenance-text';
import {
  checkLabels,
  checkSummary,
  conclusionLabels,
  checkTones,
  conclusionTones,
  executionLabels,
  toneSymbols,
  verdictLabels,
  verdictTones,
} from '../result-text';
import { describeRegion, describeVisual, diffLegend } from '../visual-text';
import { EvidenceSection } from './sections';
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
    colorScheme: 'light',
  },
  container: {
    marginInline: 'auto',
    maxWidth: geometry.workspace,
    paddingInline: {
      default: 20,
      [media.tablet]: 32,
      [media.desktop]: 48,
    },
    paddingBlock: 32,
  },
  masthead: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomStyle: 'solid',
    borderBottomWidth: 1,
    display: 'flex',
    flexWrap: 'wrap',
    gap: 16,
    justifyContent: 'space-between',
    paddingBottom: 20,
    marginBottom: 32,
  },
  wordmark: { fontSize: '1.25rem', fontWeight: 500, letterSpacing: '-0.025em' },
  main: { display: 'grid', gap: 48, minWidth: 0 },
  section: { display: 'grid', gap: 20, minWidth: 0 },
  stack: { display: 'grid', gap: 12, minWidth: 0 },
  title: {
    fontSize: { default: '1.5rem', [media.tablet]: '2rem' },
    fontWeight: 500,
    letterSpacing: '-0.02em',
    lineHeight: 1.2,
    maxWidth: '40ch',
  },
  lead: { fontSize: '1.0625rem', maxWidth: '68ch' },
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
  },
  disclosureTitle: {
    display: 'inline',
    fontSize: '1.25rem',
    fontWeight: 500,
  },
  disclosureBody: { paddingBottom: 32, paddingTop: 8 },
  subheading: { fontSize: '1.25rem', fontWeight: 500, lineHeight: 1.35 },
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
    gap: 8,
    justifySelf: 'start',
    paddingBlock: 4,
    paddingInline: 8,
  },
  neutral: {
    backgroundColor: colors.surfaceMuted,
    color: colors.textSecondary,
  },
  checked: { backgroundColor: colors.checkedFill, color: colors.checked },
  regression: {
    backgroundColor: colors.regressionFill,
    color: colors.regression,
  },
  unknown: { backgroundColor: colors.unknownFill, color: colors.unknown },
  list: { display: 'grid', gap: 8, paddingInlineStart: 20, marginBlock: 0 },
  verdicts: {
    display: 'grid',
    gap: 16,
    listStyle: 'none',
    marginBlock: 0,
    maxWidth: '68ch',
    paddingInlineStart: 0,
  },
  verdict: { display: 'grid', gap: 4, minWidth: 0 },
  verdictHeader: {
    alignItems: 'center',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 12,
  },
  verdictName: { fontWeight: 500 },
  journeyLabel: { fontSize: '1rem', fontWeight: 500 },
  journeyTitle: {
    fontSize: { default: '1.25rem', [media.tablet]: '1.5rem' },
    fontWeight: 500,
    letterSpacing: '-0.01em',
    lineHeight: 1.3,
  },
  summary: {
    alignContent: 'center',
    cursor: 'pointer',
    minHeight: geometry.target,
    paddingBlock: 12,
    fontWeight: 500,
    outlineColor: { default: colors.focus, [media.forcedColors]: 'Highlight' },
    outlineOffset: 3,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
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

function CheckPanel({ check, label }: { check: Check; label: string }) {
  return (
    <section
      {...stylex.props(styles.panel)}
      aria-label={`${label} named check: ${check.name}`}
    >
      <p {...stylex.props(styles.small)}>
        {label} · {check.authority}
      </p>
      <h3 {...stylex.props(styles.subheading)}>{check.name}</h3>
      <span {...stylex.props(styles.badge, styles[checkTones[check.outcome]])}>
        <span aria-hidden="true">{toneSymbols[checkTones[check.outcome]]}</span>
        {checkLabels[check.outcome]}
      </span>
      <p>{check.detail}</p>
      <dl {...stylex.props(styles.definition)}>
        <Field label="Expectation">{check.expectation}</Field>
        <Field label="Scope">{check.scope}</Field>
        <Field label="Actual">
          {check.actual === null ? 'Unknown' : check.actual}
        </Field>
        <Field label="Check ID" mono>
          {check.id}
        </Field>
      </dl>
    </section>
  );
}

function SideChecks({ side, label }: { side: Side; label: string }) {
  return (
    <div {...stylex.props(styles.stack)}>
      {side.checks.length === 0 ? (
        <p {...stylex.props(styles.text)}>
          {label}: no named check is configured, so nothing was verified.
        </p>
      ) : (
        side.checks.map((check) => (
          <CheckPanel key={check.id} check={check} label={label} />
        ))
      )}
    </div>
  );
}

function Verdicts({ verdicts }: { verdicts: readonly CheckVerdict[] }) {
  return (
    <ul {...stylex.props(styles.verdicts)}>
      {verdicts.map((item) => {
        const tone = verdictTones[item.verdict];

        return (
          <li key={item.id} {...stylex.props(styles.verdict)}>
            <div {...stylex.props(styles.verdictHeader)}>
              <span {...stylex.props(styles.badge, styles[tone])}>
                <span aria-hidden="true">{toneSymbols[tone]}</span>
                {verdictLabels[item.verdict]}
              </span>
              <span {...stylex.props(styles.verdictName)}>{item.name}</span>
            </div>
            <p {...stylex.props(styles.text)}>Scope: {item.scope}</p>
            <p {...stylex.props(styles.small)}>{item.detail}</p>
          </li>
        );
      })}
    </ul>
  );
}

function CheckSummary({ result }: { result: Comparison }) {
  const multiple = result.journeys.length > 1;

  return (
    <section {...stylex.props(styles.stack)} aria-labelledby="named-checks">
      <h2 id="named-checks" {...stylex.props(styles.subheading)}>
        {checkSummary(result)}
      </h2>
      {result.summary.total === 0 ? (
        <p {...stylex.props(styles.text)}>
          No behavior was verified. The captures show the application only.
        </p>
      ) : (
        result.journeys.map((journey, index) =>
          journey.checks.length === 0 ? (
            <p key={index} {...stylex.props(styles.text)}>
              {journey.title}: no named check configured.
            </p>
          ) : (
            <div key={index} {...stylex.props(styles.stack)}>
              {multiple ? (
                <h3 {...stylex.props(styles.journeyLabel)}>{journey.title}</h3>
              ) : null}
              <Verdicts verdicts={journey.checks} />
            </div>
          ),
        )
      )}
    </section>
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
      <h3 {...stylex.props(styles.subheading)}>{label}</h3>
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
    </section>
  );
}

function Availability({
  comparison,
  headingId,
}: {
  comparison: Journey['comparison'];
  headingId: string;
}) {
  if (comparison.kind === 'preview') {
    return (
      <p {...stylex.props(styles.text)}>
        Single capture. No comparison requested.
      </p>
    );
  }

  return (
    <section {...stylex.props(styles.stack)} aria-labelledby={headingId}>
      <h3 id={headingId} {...stylex.props(styles.subheading)}>
        Comparison
      </h3>
      {comparison.kind === 'unavailable' ? (
        <>
          <span {...stylex.props(styles.badge, styles.unknown)}>
            <span aria-hidden="true">{toneSymbols.unknown}</span>Unavailable
          </span>
          <ul {...stylex.props(styles.list)}>
            {comparison.reasons.map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p {...stylex.props(styles.text)}>Available. {comparison.basis}</p>
          <dl {...stylex.props(styles.definition)}>
            <Field label="Request count difference (candidate minus base)">
              {comparison.requestDifference}
            </Field>
            <Field label="Screenshot pixels">
              {describeVisual(comparison.visual)}
              {comparison.visual.kind === 'changed' ? (
                <ul {...stylex.props(styles.list)}>
                  {comparison.visual.regions.map((region, index) => (
                    <li key={index}>{describeRegion(region)}</li>
                  ))}
                </ul>
              ) : null}
            </Field>
          </dl>
        </>
      )}
    </section>
  );
}

function Disclosure({
  id,
  title,
  level = 2,
  children,
}: {
  id: string;
  title: string;
  level?: 2 | 3;
  children: ReactNode;
}) {
  const Heading = level === 2 ? 'h2' : 'h3';

  return (
    <details id={id} {...stylex.props(styles.disclosure)}>
      <summary {...stylex.props(styles.summary)}>
        <Heading {...stylex.props(styles.disclosureTitle)}>{title}</Heading>
      </summary>
      <div {...stylex.props(styles.section, styles.disclosureBody)}>
        {children}
      </div>
    </details>
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

function journeyUnresolved(journey: Journey, mode: Comparison['mode']) {
  const sides = journeySides(journey, mode);
  const sideIssues = sides.flatMap(({ side }) => side.unresolved);

  return [
    ...sides.flatMap(({ side, label }) =>
      side.unresolved.map((reason) => `${label}: ${reason}`),
    ),
    ...(journey.comparison.kind === 'unavailable'
      ? journey.comparison.reasons.filter(
          (reason) => !sideIssues.some((issue) => reason.endsWith(issue)),
        )
      : []),
  ];
}

function JourneyView({
  journey,
  mode,
  evaluatedAt,
  index,
  multiple,
}: {
  journey: Journey;
  mode: Comparison['mode'];
  evaluatedAt: string;
  index: number;
  multiple: boolean;
}) {
  const sides = journeySides(journey, mode);
  const [highlighted, setHighlighted] = useState(false);
  const visual =
    journey.comparison.kind === 'available' ? journey.comparison.visual : null;
  const highlight: Highlight | null =
    highlighted && visual?.kind === 'changed' ? visual : null;
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
              mode === 'preview' ? 'Application capture' : 'Before and after',
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
      <div id={`${prefix}screenshots`} {...stylex.props(styles.section)}>
        {visual === null ? null : (
          <div {...stylex.props(styles.stack)}>
            <p {...stylex.props(styles.text)}>
              {describeVisual(visual)}
              {visual.kind === 'changed' || visual.kind === 'size-differs'
                ? ' An observation, not a check.'
                : ''}
            </p>
            {visual.kind === 'changed' ? (
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
            ) : null}
            {visual.kind === 'changed' ? (
              <p {...stylex.props(styles.small)}>{diffLegend}</p>
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
              level={level}
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
            level={level}
          />
        ) : null}
      </div>

      <div {...stylex.props(styles.disclosures)}>
        <Disclosure id={`${prefix}checks`} title="Checks" level={level}>
          <div {...stylex.props(mode === 'comparison' && styles.grid)}>
            {sides.map(({ side, label }) => (
              <SideChecks key={label} side={side} label={label} />
            ))}
          </div>
        </Disclosure>
        <Disclosure id={`${prefix}requests`} title="Requests" level={level}>
          <p {...stylex.props(styles.text)}>
            Recorded by the browser. A response status is not a check result.
          </p>
          <div {...stylex.props(styles.grid)}>
            {sides.map(({ side, label }) => (
              <RequestLedger key={label} side={side} label={label} />
            ))}
          </div>
        </Disclosure>
        {journeySections(journey).map((section) => (
          <Disclosure
            key={section.kind}
            id={`${prefix}evidence-${section.kind}`}
            title={evidenceKinds[section.kind].title}
            level={level}
          >
            <EvidenceSection section={section} />
          </Disclosure>
        ))}
        <Disclosure
          id={`${prefix}captures`}
          title="Captures and comparison"
          level={level}
        >
          <p {...stylex.props(styles.small)}>
            Evaluated at <time dateTime={evaluatedAt}>{evaluatedAt}</time>
          </p>
          <div {...stylex.props(styles.grid)}>
            {sides.map(({ side, label }) => (
              <Identity key={label} side={side} label={label} />
            ))}
          </div>
          <Availability
            comparison={journey.comparison}
            headingId={`${prefix}availability`}
          />
        </Disclosure>
        <Disclosure
          id={`${prefix}artifacts`}
          title="Original artifacts"
          level={level}
        >
          <p {...stylex.props(styles.text)}>
            Integrity describes availability and hash verification, not
            application correctness.
          </p>
          <div {...stylex.props(styles.grid)}>
            {sides.map(({ side, label }) => (
              <Artifacts key={label} side={side} label={label} />
            ))}
          </div>
        </Disclosure>
        <Disclosure id={`${prefix}limits`} title="Limits" level={level}>
          <ul {...stylex.props(styles.list)}>
            {journey.limitations.map((limitation, item) => (
              <li key={item}>{limitation}</li>
            ))}
          </ul>
        </Disclosure>
      </div>
    </section>
  );
}

export function ComparisonReport({ result }: { result: Comparison }) {
  const multiple = result.journeys.length > 1;
  const unresolved = result.journeys.flatMap((journey) =>
    journeyUnresolved(journey, result.mode).map((reason) =>
      multiple ? `${journey.title}: ${reason}` : reason,
    ),
  );
  const tone = conclusionTones[result.conclusion.kind];

  return (
    <div {...stylex.props(styles.canvas)}>
      <a href="#report" {...stylex.props(styles.skip)}>
        Skip to report
      </a>
      <div {...stylex.props(styles.container)}>
        <header {...stylex.props(styles.masthead)}>
          <span {...stylex.props(styles.wordmark)}>observed</span>
          <span {...stylex.props(styles.small)}>
            {result.mode === 'preview'
              ? 'Application preview'
              : 'Application comparison'}
          </span>
        </header>
        <main id="report" tabIndex={-1} {...stylex.props(styles.main)}>
          <section
            {...stylex.props(styles.stack)}
            aria-labelledby="report-title"
          >
            <span {...stylex.props(styles.badge, styles[tone])}>
              <span aria-hidden="true">{toneSymbols[tone]}</span>
              {conclusionLabels[result.conclusion.kind]}
            </span>
            <h1 id="report-title" {...stylex.props(styles.title)}>
              {result.title}
            </h1>
            <p {...stylex.props(styles.lead)}>{result.conclusion.text}</p>
            <p {...stylex.props(styles.text)}>
              <EvidenceLink href="#named-checks">
                {checkSummary(result)}
              </EvidenceLink>
            </p>
            {unresolved.length === 0 ? null : (
              <div {...stylex.props(styles.notice)}>
                <p {...stylex.props(styles.noticeTitle)}>
                  <span aria-hidden="true">{toneSymbols.unknown}</span>{' '}
                  Unresolved
                </p>
                <ul {...stylex.props(styles.list)}>
                  {unresolved.map((reason, index) => (
                    <li key={index}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {result.journeys.map((journey, index) => (
            <JourneyView
              key={index}
              journey={journey}
              mode={result.mode}
              evaluatedAt={result.evaluatedAt}
              index={index}
              multiple={multiple}
            />
          ))}

          <CheckSummary result={result} />

          <nav aria-label="Report files" {...stylex.props(styles.nav)}>
            <EvidenceLink href="./report.md">Markdown report</EvidenceLink>
            <EvidenceLink href="./result.json">Result JSON</EvidenceLink>
          </nav>
        </main>
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
