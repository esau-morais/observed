import * as stylex from '@stylexjs/stylex';
import {
  describeErrorCoverage,
  describeErrorTime,
  errorSourceLabels,
} from '../../interaction-text';
import { fonts, geometry, media } from '../constants.stylex';
import { SubHeading } from '../heading';
import { colors } from '../tokens.stylex';
import type { SectionSide, ViewerSection } from './define';

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
  stack: { display: 'grid', gap: 16, alignContent: 'start', minWidth: 0 },
  heading: { fontSize: '1.25rem', fontWeight: 500, lineHeight: 1.35 },
  text: { color: colors.textSecondary, maxWidth: '68ch' },
  caption: { color: colors.textMuted, fontSize: '0.8125rem' },
  missing: {
    backgroundColor: colors.unknownFill,
    borderRadius: geometry.radius,
    color: colors.unknown,
    padding: 16,
  },
  list: { display: 'grid', gap: 16, margin: 0, paddingInlineStart: 20 },
  entry: { display: 'grid', gap: 4, minWidth: 0 },
  summary: {
    cursor: 'pointer',
    minHeight: geometry.target,
    alignContent: 'center',
    outlineColor: { default: colors.focus, [media.forcedColors]: 'Highlight' },
    outlineOffset: 3,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
  },
  message: {
    fontFamily: fonts.mono,
    fontSize: '0.8125rem',
    margin: 0,
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
  },
});

function ErrorsPanel({
  side,
  label,
}: {
  side: SectionSide<'browser-errors'>;
  label: string;
}) {
  const view = side.evidence;

  return (
    <section {...stylex.props(styles.stack)} aria-label={`${label} errors`}>
      <SubHeading xstyle={styles.heading}>{label}</SubHeading>
      {view.status === 'unavailable' ? (
        <p {...stylex.props(styles.missing)}>
          Error record unavailable. {view.reason}.
        </p>
      ) : (
        <>
          <p
            {...stylex.props(
              view.value.coverage.kind === 'complete'
                ? styles.caption
                : styles.missing,
            )}
          >
            {describeErrorCoverage(view.value)}
          </p>
          {view.value.entries.length === 0 ? (
            <p {...stylex.props(styles.text)}>
              No page or console errors were read.
            </p>
          ) : (
            <ol {...stylex.props(styles.list)}>
              {view.value.entries.map((error, index) => {
                const [first = '', ...rest] = error.text.split('\n');

                return (
                  <li key={index} {...stylex.props(styles.entry)}>
                    <p>
                      {errorSourceLabels[error.source]} ·{' '}
                      <span {...stylex.props(styles.caption)}>
                        {describeErrorTime(error)}
                      </span>
                    </p>
                    <p {...stylex.props(styles.message)}>
                      {first === '' ? '(empty message)' : first}
                    </p>
                    {rest.length === 0 ? null : (
                      <details>
                        <summary {...stylex.props(styles.summary)}>
                          Full message
                        </summary>
                        <pre {...stylex.props(styles.message)}>
                          {error.text}
                        </pre>
                      </details>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </section>
  );
}

export const BrowserErrorsSection: ViewerSection<'browser-errors'> = ({
  base,
  candidate,
}) => (
  <div {...stylex.props(styles.stack)}>
    <p {...stylex.props(styles.text)}>
      Uncaught page errors and console errors, with the step after which each
      was read. A listed error is not a check result.
    </p>
    <div {...stylex.props(styles.grid)}>
      {base !== null && <ErrorsPanel label="Before" side={base} />}
      <ErrorsPanel
        label={base === null ? 'Current capture' : 'After'}
        side={candidate}
      />
    </div>
  </div>
);
