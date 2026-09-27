import * as stylex from '@stylexjs/stylex';
import { renderChanges, type ReactEvidence } from '../../evidence-kinds/react';
import { fonts, geometry, media } from '../constants.stylex';
import { colors } from '../tokens.stylex';
import type { SectionSide, ViewerSection } from './define';

const styles = stylex.create({
  stack: { display: 'grid', gap: 12, minWidth: 0 },
  sides: {
    display: 'grid',
    gap: 24,
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      [media.tablet]: 'repeat(2, minmax(0, 1fr))',
    },
  },
  heading: { fontSize: '1.25rem', fontWeight: 500, lineHeight: 1.35 },
  subheading: { fontWeight: 500 },
  text: { color: colors.textSecondary, maxWidth: '68ch' },
  caption: { color: colors.textMuted, fontSize: '0.8125rem' },
  mono: {
    fontFamily: fonts.mono,
    fontSize: '0.8125rem',
    overflowWrap: 'anywhere',
  },
  missing: {
    padding: 24,
    backgroundColor: colors.unknownFill,
    color: colors.unknown,
    borderRadius: geometry.radius,
  },
  scroll: {
    overflowX: 'auto',
    borderColor: colors.border,
    borderStyle: 'solid',
    borderWidth: 1,
    borderRadius: geometry.radius,
    outlineColor: {
      default: colors.focus,
      [media.forcedColors]: 'Highlight',
    },
    outlineOffset: 3,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
  },
  table: { borderCollapse: 'collapse', width: '100%', textAlign: 'start' },
  cell: {
    borderBottomColor: colors.border,
    borderBottomStyle: 'solid',
    borderBottomWidth: 1,
    padding: 12,
    verticalAlign: 'top',
    textAlign: 'start',
  },
  number: { textAlign: 'end', fontVariantNumeric: 'tabular-nums' },
  column: {
    backgroundColor: colors.surfaceMuted,
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },
  tree: { display: 'grid', gap: 4, margin: 0, padding: 0, listStyle: 'none' },
  depth: (depth: number) => ({ paddingInlineStart: `${depth * 16}px` }),
});

function Table({
  label,
  columns,
  rows,
}: {
  label: string;
  columns: readonly string[];
  rows: readonly (readonly [string, ...(string | number)[]])[];
}) {
  return (
    <div
      {...stylex.props(styles.scroll)}
      role="region"
      aria-label={`${label}, scroll horizontally for all columns`}
      tabIndex={0}
    >
      <table {...stylex.props(styles.table)}>
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th
                key={column}
                scope="col"
                {...stylex.props(
                  styles.cell,
                  styles.column,
                  index > 0 && styles.number,
                )}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, ...values]) => (
            <tr key={name}>
              <th scope="row" {...stylex.props(styles.cell, styles.mono)}>
                {name}
              </th>
              {values.map((value, index) => (
                <td
                  key={index}
                  {...stylex.props(styles.cell, styles.mono, styles.number)}
                >
                  {value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Changes({
  base,
  candidate,
}: {
  base: ReactEvidence;
  candidate: ReactEvidence;
}) {
  const changes = renderChanges(base, candidate);

  if (changes.length === 0) {
    return (
      <p {...stylex.props(styles.text)}>
        Each component rendered the same number of times before and after.
      </p>
    );
  }

  return (
    <div {...stylex.props(styles.stack)}>
      <p {...stylex.props(styles.subheading)}>Render changes during steps</p>
      <Table
        label="Render changes"
        columns={['Component', 'Before', 'After', 'Change']}
        rows={changes.map((change) => {
          const delta = change.candidate - change.base;

          return [
            change.name,
            change.base,
            change.candidate,
            delta > 0 ? `+${delta} added` : `${-delta} removed`,
          ];
        })}
      />
    </div>
  );
}

function Recording({ value, label }: { value: ReactEvidence; label: string }) {
  const renderers = value.renderers
    .map(
      (renderer) =>
        `React ${renderer.version ?? 'version unknown'}, ${renderer.build} build`,
    )
    .join('; ');
  const limits = [
    value.truncated.components && 'rendered components',
    value.truncated.mounted && 'mounted component names',
    value.truncated.subtree && 'the rendered subtree',
  ].filter((item) => item !== false);

  return (
    <div {...stylex.props(styles.stack)}>
      <p {...stylex.props(styles.text)}>
        {value.commits} commit(s) during steps. {renderers}.
      </p>
      {limits.length > 0 ? (
        <p {...stylex.props(styles.missing)}>
          Recording limit reached for {limits.join(', ')}; components beyond it
          are not listed.
        </p>
      ) : null}
      {value.components.length === 0 ? (
        <p {...stylex.props(styles.text)}>
          No component rendered during steps.
        </p>
      ) : (
        <Table
          label={`${label} renders by component`}
          columns={['Component', 'Renders', 'Mounts', 'Updates']}
          rows={value.components.map((item) => [
            item.name,
            item.mounts + item.updates,
            item.mounts,
            item.updates,
          ])}
        />
      )}
      {value.subtree.length > 0 ? (
        <div {...stylex.props(styles.stack)}>
          <p {...stylex.props(styles.subheading)}>Rendered subtree</p>
          <ul
            {...stylex.props(styles.tree)}
            aria-label={`${label} rendered subtree`}
          >
            {value.subtree.map((node, index) => (
              <li
                key={index}
                {...stylex.props(styles.mono, styles.depth(node.depth))}
              >
                {node.name}
                {node.rendered ? ' (rendered)' : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {value.sources.length > 0 ? (
        <div {...stylex.props(styles.stack)}>
          <p {...stylex.props(styles.subheading)}>Script positions</p>
          <p {...stylex.props(styles.caption)}>
            Where React DevTools located each component in the script the
            browser loaded. Positions are not source-mapped.
          </p>
          <ul {...stylex.props(styles.tree)}>
            {value.sources.map((source) => (
              <li key={source.component} {...stylex.props(styles.mono)}>
                {source.component}: {source.script}:{source.line}:
                {source.column}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Side({
  side: { evidence: view },
  label,
}: {
  side: SectionSide<'react'>;
  label: string;
}) {
  return (
    <section
      {...stylex.props(styles.stack)}
      aria-label={`${label} React renders`}
    >
      <h3 {...stylex.props(styles.heading)}>{label}</h3>
      {view.status === 'recorded' ? (
        <Recording value={view.value} label={label} />
      ) : (
        <p {...stylex.props(styles.missing)}>
          React evidence unavailable: {view.reason}
        </p>
      )}
    </section>
  );
}

export const ReactSection: ViewerSection<'react'> = ({ base, candidate }) => {
  const before = base?.evidence;
  const after = candidate.evidence;

  return (
    <div {...stylex.props(styles.stack)}>
      <p {...stylex.props(styles.caption)}>
        Counted in a separate browser run with React DevTools enabled. A render
        counts when React commits work for the component during the
        journey&apos;s steps, as React DevTools highlights it; a render React
        discards after bailing out does not. Components that share a name are
        summed. These counts are not timing measurements.
      </p>
      {before?.status === 'recorded' && after.status === 'recorded' ? (
        <Changes base={before.value} candidate={after.value} />
      ) : null}
      <div {...stylex.props(styles.sides)}>
        {base === null ? null : <Side side={base} label="Before" />}
        <Side
          side={candidate}
          label={base === null ? 'Current capture' : 'After'}
        />
      </div>
    </div>
  );
};
