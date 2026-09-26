import * as stylex from '@stylexjs/stylex';
import { useState, type ReactNode } from 'react';
import type { Comparison, Side } from '../comparison-model';
import { fonts, geometry, media } from './constants.stylex';
import {
  Artifacts,
  EvidenceLink,
  RequestLedger,
  Screenshot,
  units,
  visualSummary,
  type Highlight,
} from './evidence';
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
  heading: { fontSize: '1.5rem', fontWeight: 500, lineHeight: 1.25 },
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

function Check({ side, label }: { side: Side; label: string }) {
  const check = side.check;
  const symbols = { passed: '✓', failed: '!', unknown: '?', 'not-run': '–' };

  return (
    <section
      {...stylex.props(styles.panel)}
      aria-label={`${label} named check`}
    >
      <p {...stylex.props(styles.small)}>
        {label} · {check.authority}
      </p>
      <h3 {...stylex.props(styles.subheading)}>{check.name}</h3>
      <span
        {...stylex.props(
          styles.badge,
          check.outcome === 'passed' && styles.checked,
          check.outcome === 'failed' && styles.regression,
          check.outcome === 'unknown' && styles.unknown,
        )}
      >
        <span aria-hidden="true">{symbols[check.outcome]}</span>
        {check.outcome}
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

function CaptureDetails({ side }: { side: Side }) {
  if (side.capture === null) {
    return <p {...stylex.props(styles.text)}>Capture metadata unavailable.</p>;
  }

  const capture = side.capture.manifest;

  return (
    <details>
      <summary {...stylex.props(styles.summary)}>
        Producer, conditions, recipe and source files
      </summary>
      <dl {...stylex.props(styles.definition)}>
        <Field label="Application">{capture.application}</Field>
        <Field label="Capture ID" mono>
          {capture.id}
        </Field>
        <Field label="Manifest SHA-256" mono>
          {side.capture.sha256}
        </Field>
        <Field label="Producer">
          {capture.producer.name} · {capture.producer.version}
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
      <p {...stylex.props(styles.small)}>Execution: {side.execution}</p>
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

function Availability({ result }: { result: Comparison }) {
  const comparison = result.comparison;

  if (comparison.kind === 'preview') {
    return (
      <p {...stylex.props(styles.text)}>
        Single capture. No comparison requested.
      </p>
    );
  }

  return (
    <section {...stylex.props(styles.stack)} aria-labelledby="availability">
      <h2 id="availability" {...stylex.props(styles.heading)}>
        Comparison availability
      </h2>
      {comparison.kind === 'unavailable' ? (
        <>
          <span {...stylex.props(styles.badge, styles.unknown)}>
            <span aria-hidden="true">?</span>Unavailable
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
              {visualSummary(comparison.visual)}
              {comparison.visual.kind === 'changed' ? (
                <ul {...stylex.props(styles.list)}>
                  {comparison.visual.regions.map((region, index) => (
                    <li key={index}>
                      {region.width} × {region.height} px at x {region.x}, y{' '}
                      {region.y}: {units(region.changedPixels, 'changed pixel')}
                    </li>
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

export function ComparisonReport({ result }: { result: Comparison }) {
  const conclusionLabels = {
    regression: 'Regression',
    'no-regression': 'No regression',
    unavailable: 'Conclusion unavailable',
    'not-checked': 'Visual comparison',
    preview: 'Preview',
    'check-failed': 'Check failed',
  };
  const sides =
    result.mode === 'preview'
      ? [{ side: result.candidate, label: 'Current capture' }]
      : [
          { side: result.base, label: 'Before' },
          { side: result.candidate, label: 'After' },
        ];
  const unresolved = sides.flatMap(({ side, label }) =>
    side.unresolved.map((reason) => `${label}: ${reason}`),
  );
  const failed =
    result.conclusion.kind === 'regression' ||
    result.conclusion.kind === 'check-failed';
  const [highlighted, setHighlighted] = useState(false);
  const visual =
    result.comparison.kind === 'available' ? result.comparison.visual : null;
  const highlight: Highlight | null =
    highlighted && visual?.kind === 'changed' ? visual : null;

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
            {...stylex.props(styles.section)}
            aria-labelledby="report-title"
          >
            <h1 id="report-title" {...stylex.props(styles.title)}>
              {result.title}
            </h1>
            {failed || result.conclusion.kind === 'unavailable' ? (
              <p {...stylex.props(styles.text)}>{result.conclusion.text}</p>
            ) : null}
          </section>

          <section
            id="screenshots"
            {...stylex.props(styles.section)}
            aria-label={
              result.mode === 'preview'
                ? 'Application capture'
                : 'Before and after'
            }
          >
            {visual === null ? null : (
              <div {...stylex.props(styles.stack)}>
                <p {...stylex.props(styles.text)}>{visualSummary(visual)}</p>
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
              </div>
            )}
            <div {...stylex.props(result.mode === 'comparison' && styles.grid)}>
              {sides.map(({ side, label }) => (
                <Screenshot
                  key={label}
                  side={side}
                  label={label}
                  highlight={highlight}
                />
              ))}
            </div>
          </section>

          <details>
            <summary {...stylex.props(styles.summary)}>
              Checks and capture details
            </summary>
            <div {...stylex.props(styles.main)}>
              <div {...stylex.props(styles.stack)}>
                <span
                  {...stylex.props(
                    styles.badge,
                    failed && styles.regression,
                    result.conclusion.kind === 'unavailable' && styles.unknown,
                    (result.conclusion.kind === 'no-regression' ||
                      result.conclusion.kind === 'not-checked' ||
                      result.conclusion.kind === 'preview') &&
                      styles.neutral,
                  )}
                >
                  {failed || result.conclusion.kind === 'unavailable' ? (
                    <span aria-hidden="true">{failed ? '!' : '?'}</span>
                  ) : null}
                  {conclusionLabels[result.conclusion.kind]}
                </span>
                <p {...stylex.props(styles.text)}>{result.conclusion.text}</p>
                <p {...stylex.props(styles.small)}>
                  Evaluated at{' '}
                  <time dateTime={result.evaluatedAt}>
                    {result.evaluatedAt}
                  </time>
                </p>
              </div>
              <nav aria-label="Evidence" {...stylex.props(styles.nav)}>
                <EvidenceLink href="#checks">Checks</EvidenceLink>
                <EvidenceLink href="#requests">Requests</EvidenceLink>
                <EvidenceLink href="#artifacts">Artifacts</EvidenceLink>
                <EvidenceLink href="./report.md">Markdown</EvidenceLink>
                <EvidenceLink href="./result.json">JSON</EvidenceLink>
              </nav>
              <section
                {...stylex.props(styles.stack)}
                aria-labelledby="unresolved"
              >
                <h2 id="unresolved" {...stylex.props(styles.heading)}>
                  Unresolved evidence and limits
                </h2>
                <ul {...stylex.props(styles.list)}>
                  {unresolved.map((reason, index) => (
                    <li key={`capture-${index}`}>{reason}</li>
                  ))}
                  {result.limitations.map((limitation, index) => (
                    <li key={`limit-${index}`}>{limitation}</li>
                  ))}
                </ul>
                {unresolved.length + result.limitations.length === 0 ? (
                  <p {...stylex.props(styles.text)}>
                    No unresolved items reported. Coverage is limited to the
                    named checks and recorded capture windows.
                  </p>
                ) : null}
              </section>

              <section
                {...stylex.props(styles.section)}
                aria-labelledby="captures"
              >
                <h2 id="captures" {...stylex.props(styles.heading)}>
                  Selected captures
                </h2>
                <div {...stylex.props(styles.grid)}>
                  {sides.map(({ side, label }) => (
                    <Identity key={label} side={side} label={label} />
                  ))}
                </div>
              </section>

              <Availability result={result} />

              <section
                {...stylex.props(styles.section)}
                aria-labelledby="checks"
              >
                <h2 id="checks" {...stylex.props(styles.heading)}>
                  Absolute named checks
                </h2>
                <p {...stylex.props(styles.text)}>
                  Executed by Observed against each capture's evidence. Each
                  result covers its stated expectation and scope; comparison
                  availability is separate.
                </p>
                <div {...stylex.props(styles.grid)}>
                  {sides.map(({ side, label }) => (
                    <Check key={label} side={side} label={label} />
                  ))}
                </div>
              </section>

              <section
                {...stylex.props(styles.section)}
                aria-labelledby="requests"
              >
                <h2 id="requests" {...stylex.props(styles.heading)}>
                  Request ledger
                </h2>
                <p {...stylex.props(styles.text)}>
                  Collector measurements from the recorded windows. A recorded
                  response status is not a named check result.
                </p>
                <div {...stylex.props(styles.grid)}>
                  {sides.map(({ side, label }) => (
                    <RequestLedger key={label} side={side} label={label} />
                  ))}
                </div>
              </section>

              <section
                {...stylex.props(styles.section)}
                aria-labelledby="artifacts"
              >
                <h2 id="artifacts" {...stylex.props(styles.heading)}>
                  Original artifacts
                </h2>
                <p {...stylex.props(styles.text)}>
                  Integrity describes artifact availability and hash
                  verification, not application correctness.
                </p>
                <div {...stylex.props(styles.grid)}>
                  {sides.map(({ side, label }) => (
                    <Artifacts key={label} side={side} label={label} />
                  ))}
                </div>
              </section>
            </div>
          </details>
        </main>
        <footer {...stylex.props(styles.footer)}>
          Captured evidence · Open an image at full size.
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
            : 'No comparison result is available to display. Check the local server and result.json, then reload this page.'}
        </p>
        {detail === undefined ? null : (
          <p {...stylex.props(styles.mono)}>{detail}</p>
        )}
      </main>
    </div>
  );
}
