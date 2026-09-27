import * as stylex from '@stylexjs/stylex';
import {
  describeConditions,
  inspectionFiles,
  inspectionNote,
  performanceClaimLimit,
  performanceRows,
  type InspectionFile,
  type PerformanceCell,
} from '../../performance-text';
import { fonts, geometry, media } from '../constants.stylex';
import { EvidenceLink } from '../evidence';
import { colors } from '../tokens.stylex';
import type { SectionSide, ViewerSection } from './define';

const styles = stylex.create({
  stack: { display: 'grid', gap: 16, minWidth: 0 },
  text: { color: colors.textSecondary, maxWidth: '68ch' },
  caption: { color: colors.textMuted, fontSize: '0.8125rem' },
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
  table: { borderCollapse: 'collapse', width: '100%' },
  cell: {
    borderBottomColor: colors.border,
    borderBottomStyle: 'solid',
    borderBottomWidth: 1,
    padding: 12,
    textAlign: 'start',
    verticalAlign: 'top',
  },
  column: {
    backgroundColor: colors.surfaceMuted,
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },
  metric: { fontWeight: 500, whiteSpace: 'nowrap' },
  number: {
    fontFamily: fonts.mono,
    fontSize: '0.8125rem',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  range: { color: colors.textMuted, display: 'block', fontSize: '0.8125rem' },
  metricName: {
    color: colors.textMuted,
    display: 'block',
    fontSize: '0.8125rem',
    fontWeight: 400,
  },
  missing: { color: colors.unknown },
  notice: {
    backgroundColor: colors.unknownFill,
    borderRadius: geometry.radius,
    color: colors.unknown,
    padding: 16,
  },
  list: { display: 'grid', gap: 8, marginBlock: 0, paddingInlineStart: 20 },
});

function Value({ cell }: { cell: PerformanceCell | null }) {
  if (cell === null) {
    return null;
  }

  if (cell.kind === 'missing') {
    return <span {...stylex.props(styles.missing)}>{cell.text}</span>;
  }

  return (
    <>
      <span {...stylex.props(styles.number)}>{cell.median}</span>
      <span {...stylex.props(styles.range)}>
        Range <span {...stylex.props(styles.number)}>{cell.range}</span>
      </span>
    </>
  );
}

function File({ label, file }: { label: string; file: InspectionFile }) {
  return file.kind === 'recorded' ? (
    <EvidenceLink href={file.path}>{label}</EvidenceLink>
  ) : (
    <>
      {label} unavailable: {file.reason}
    </>
  );
}

function Inspection({
  label,
  side,
}: {
  label: string;
  side: SectionSide<'performance'> | null;
}) {
  const files =
    side === null ? null : inspectionFiles(side.evidence, side.artifacts);

  if (files === null) {
    return null;
  }

  return (
    <li>
      {label}: <File label="DevTools trace" file={files.trace} />
      {' · '}
      <File label="DevTools profile" file={files.profile} />
    </li>
  );
}

export const PerformanceSection: ViewerSection<'performance'> = ({
  base: before,
  candidate: after,
}) => {
  const base = before?.evidence ?? null;
  const candidate = after.evidence;
  const rows = performanceRows(base, candidate);
  const comparison = base !== null;
  const columns = comparison
    ? ['Metric', 'Before: median', 'After: median', 'Change']
    : ['Metric', 'Median'];
  const unavailable = [
    { label: 'Before', view: base },
    { label: comparison ? 'After' : 'Current capture', view: candidate },
  ].flatMap(({ label, view }) =>
    view?.status === 'unavailable' ? [`${label}: ${view.reason}`] : [],
  );
  const inspected = [before, after].some(
    (side) =>
      side !== null && inspectionFiles(side.evidence, side.artifacts) !== null,
  );

  return (
    <div {...stylex.props(styles.stack)}>
      <p {...stylex.props(styles.text)}>{performanceClaimLimit}</p>
      <p {...stylex.props(styles.caption)}>
        {describeConditions(base, candidate)}
      </p>
      {unavailable.length === 0 ? null : (
        <div {...stylex.props(styles.notice)}>
          <p>Timing samples unavailable</p>
          <ul {...stylex.props(styles.list)}>
            {unavailable.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
      <div
        {...stylex.props(styles.scroll)}
        role="region"
        aria-label="Timing samples, scroll horizontally for all columns"
        tabIndex={0}
      >
        <table {...stylex.props(styles.table)}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column}
                  scope="col"
                  {...stylex.props(styles.cell, styles.column)}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.metric}>
                <th scope="row" {...stylex.props(styles.cell, styles.metric)}>
                  {row.abbreviation}
                  <span {...stylex.props(styles.metricName)}>{row.label}</span>
                </th>
                {comparison ? (
                  <td {...stylex.props(styles.cell)}>
                    <Value cell={row.base} />
                  </td>
                ) : null}
                <td {...stylex.props(styles.cell)}>
                  <Value cell={row.candidate} />
                </td>
                {comparison ? (
                  <td {...stylex.props(styles.cell, styles.number)}>
                    {row.change}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {inspected ? (
        <div {...stylex.props(styles.stack)}>
          <p {...stylex.props(styles.text)}>{inspectionNote}</p>
          <ul {...stylex.props(styles.list)}>
            <Inspection label="Before" side={before} />
            <Inspection
              label={comparison ? 'After' : 'Current capture'}
              side={after}
            />
          </ul>
        </div>
      ) : null}
    </div>
  );
};
