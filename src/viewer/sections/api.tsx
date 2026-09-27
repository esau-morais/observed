import * as stylex from '@stylexjs/stylex';
import {
  apiClaimLimit,
  apiRows,
  describeContract,
  describeResponse,
  describeStatusChange,
  recordFile,
  type ApiRow,
} from '../../api-text';
import { fonts, geometry, media } from '../constants.stylex';
import { EvidenceLink } from '../evidence';
import { colors } from '../tokens.stylex';
import type { SectionSide, ViewerSection } from './define';

const styles = stylex.create({
  stack: { display: 'grid', gap: 16, minWidth: 0 },
  text: { color: colors.textSecondary, maxWidth: '68ch' },
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
  table: { borderCollapse: 'collapse', minWidth: '44rem', width: '100%' },
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
  operation: { fontWeight: 500 },
  request: {
    color: colors.textMuted,
    display: 'block',
    fontFamily: fonts.mono,
    fontSize: '0.8125rem',
    fontWeight: 400,
    overflowWrap: 'anywhere',
  },
  mono: {
    fontFamily: fonts.mono,
    fontSize: '0.8125rem',
    fontVariantNumeric: 'tabular-nums',
  },
  changes: { display: 'grid', gap: 4, margin: 0, paddingInlineStart: 0 },
  change: { color: colors.changed, listStyleType: 'none' },
  steady: { color: colors.textSecondary, listStyleType: 'none' },
  notice: {
    backgroundColor: colors.unknownFill,
    borderRadius: geometry.radius,
    color: colors.unknown,
    padding: 16,
  },
  list: { display: 'grid', gap: 8, marginBlock: 0, paddingInlineStart: 20 },
});

function Fields({ row }: { row: ApiRow }) {
  if (row.contract === null) {
    return null;
  }

  const status = describeStatusChange(row);
  const lines = describeContract(row.contract);
  const changed =
    row.contract.kind === 'compared' && row.contract.changes.length > 0;

  return (
    <ul {...stylex.props(styles.changes)}>
      {status === null ? null : (
        <li {...stylex.props(styles.change)}>Δ {status}</li>
      )}
      {lines.map((line) => (
        <li
          key={line}
          {...stylex.props(changed ? styles.change : styles.steady)}
        >
          {changed ? `Δ ${line}` : line}
        </li>
      ))}
    </ul>
  );
}

function File({
  label,
  side,
}: {
  label: string;
  side: SectionSide<'api'> | null;
}) {
  if (side === null || side.evidence.status === 'unavailable') {
    return null;
  }

  const record = recordFile(side.artifacts);

  return (
    <li>
      {record.kind === 'recorded' ? (
        <EvidenceLink href={record.path}>
          {label}: requests and responses
        </EvidenceLink>
      ) : (
        `${label}: requests and responses unavailable. ${record.reason}`
      )}
    </li>
  );
}

export const ApiSection: ViewerSection<'api'> = ({ base, candidate }) => {
  const comparison = base !== null;
  const current = comparison ? 'After' : 'Current capture';
  const rows = apiRows(base?.evidence ?? null, candidate.evidence);
  const columns = comparison
    ? ['Operation', 'Before', 'After', 'Fields']
    : ['Operation', 'Response'];
  const unavailable = [
    { label: 'Before', view: base?.evidence ?? null },
    { label: current, view: candidate.evidence },
  ].flatMap(({ label, view }) =>
    view?.status === 'unavailable' ? [`${label}: ${view.reason}`] : [],
  );

  return (
    <div {...stylex.props(styles.stack)}>
      <p {...stylex.props(styles.text)}>{apiClaimLimit}</p>
      {unavailable.length === 0 ? null : (
        <div {...stylex.props(styles.notice)}>
          <p>API operations unavailable</p>
          <ul {...stylex.props(styles.list)}>
            {unavailable.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
      {rows.length === 0 ? null : (
        <div
          {...stylex.props(styles.scroll)}
          role="region"
          aria-label="API operations, scroll horizontally for all columns"
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
                <tr key={row.id}>
                  <th
                    scope="row"
                    {...stylex.props(styles.cell, styles.operation)}
                  >
                    {row.id}
                    <span {...stylex.props(styles.request)}>{row.request}</span>
                  </th>
                  {comparison ? (
                    <td {...stylex.props(styles.cell, styles.mono)}>
                      {describeResponse(row.base)}
                    </td>
                  ) : null}
                  <td {...stylex.props(styles.cell, styles.mono)}>
                    {describeResponse(row.candidate)}
                  </td>
                  {comparison ? (
                    <td {...stylex.props(styles.cell)}>
                      <Fields row={row} />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ul {...stylex.props(styles.list)}>
        <File label="Before" side={base} />
        <File label={current} side={candidate} />
      </ul>
    </div>
  );
};
