import * as stylex from '@stylexjs/stylex';
import { use } from 'react';
import {
  describeAction,
  describeDuration,
  stepOutcomeLabels,
} from '../../interaction-text';
import { fonts, geometry, media } from '../constants.stylex';
import { HeadingLevel, SubHeading } from '../heading';
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
  subheading: { fontSize: '1rem', fontWeight: 500 },
  text: { color: colors.textSecondary, maxWidth: '68ch' },
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
  scroll: {
    borderColor: colors.border,
    borderRadius: geometry.radius,
    borderStyle: 'solid',
    borderWidth: 1,
    overflowX: 'auto',
    outlineColor: { default: colors.focus, [media.forcedColors]: 'Highlight' },
    outlineOffset: 3,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
  },
  tree: {
    fontFamily: fonts.mono,
    fontSize: '0.8125rem',
    margin: 0,
    maxHeight: '32rem',
    overflowY: 'auto',
    padding: 16,
    whiteSpace: 'pre',
  },
  table: { borderCollapse: 'collapse', textAlign: 'start', width: '100%' },
  cell: {
    borderBottomColor: colors.border,
    borderBottomStyle: 'solid',
    borderBottomWidth: 1,
    padding: 12,
    textAlign: 'start',
    verticalAlign: 'top',
  },
  column: { backgroundColor: colors.surfaceMuted, fontWeight: 500 },
  nowrap: { whiteSpace: 'nowrap' },
  failed: { color: colors.unknown, fontWeight: 500 },
});

function StateHeading() {
  const Heading = use(HeadingLevel) === 3 ? 'h4' : 'h5';

  return (
    <Heading {...stylex.props(styles.subheading)}>Resulting state</Heading>
  );
}

function TimelinePanel({
  side,
  label,
}: {
  side: SectionSide<'timeline'>;
  label: string;
}) {
  const view = side.evidence;

  return (
    <section {...stylex.props(styles.stack)} aria-label={`${label} steps`}>
      <SubHeading xstyle={styles.heading}>{label}</SubHeading>
      {view.status === 'unavailable' ? (
        <p {...stylex.props(styles.missing)}>
          Steps unavailable. {view.reason}.
        </p>
      ) : (
        <>
          {view.value.steps.length === 0 ? (
            <p {...stylex.props(styles.text)}>No steps are configured.</p>
          ) : (
            <div
              {...stylex.props(styles.scroll)}
              role="region"
              aria-label={`${label} steps, scroll horizontally for all columns`}
              tabIndex={0}
            >
              <table {...stylex.props(styles.table)}>
                <thead>
                  <tr>
                    {['Step', 'Action', 'Target', 'Duration', 'Outcome'].map(
                      (column) => (
                        <th
                          key={column}
                          scope="col"
                          {...stylex.props(
                            styles.cell,
                            styles.column,
                            styles.nowrap,
                          )}
                        >
                          {column}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {view.value.steps.map((step) => (
                    <tr key={step.index}>
                      <td {...stylex.props(styles.cell)}>{step.index + 1}</td>
                      <td {...stylex.props(styles.cell, styles.nowrap)}>
                        {describeAction(step.action)}
                      </td>
                      <td {...stylex.props(styles.cell, styles.mono)}>
                        {step.target ?? '–'}
                      </td>
                      <td {...stylex.props(styles.cell, styles.nowrap)}>
                        {describeDuration(step)}
                      </td>
                      <td
                        {...stylex.props(
                          styles.cell,
                          styles.nowrap,
                          step.outcome === 'failed' && styles.failed,
                        )}
                      >
                        {stepOutcomeLabels[step.outcome]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <StateHeading />
          {view.value.finalState.kind === 'unavailable' ? (
            <p {...stylex.props(styles.missing)}>
              {view.value.finalState.reason}.
            </p>
          ) : (
            <>
              <p {...stylex.props(styles.text)}>
                Accessibility tree after the last step, from agent-browser
                snapshot. The screenshot above shows the same state.
              </p>
              <div
                {...stylex.props(styles.scroll)}
                role="region"
                aria-label={`${label} accessibility tree`}
                tabIndex={0}
              >
                <pre {...stylex.props(styles.tree)}>
                  {view.value.finalState.tree}
                </pre>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

export const TimelineSection: ViewerSection<'timeline'> = ({
  base,
  candidate,
}) => (
  <div {...stylex.props(styles.grid)}>
    {base !== null && <TimelinePanel label="Before" side={base} />}
    <TimelinePanel
      label={base === null ? 'Current capture' : 'After'}
      side={candidate}
    />
  </div>
);
