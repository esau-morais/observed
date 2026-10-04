import * as stylex from '@stylexjs/stylex';
import { createContext, use, useState, type ReactNode } from 'react';
import type { Side } from '../comparison-model';
import { describeRevision, shortSource } from '../provenance-text';
import {
  requestDiff,
  type RequestChange,
  type RequestRow,
} from '../request-diff';
import { describeStatus } from '../request-text';
import { integrityLabels } from '../result-text';
import { fonts, geometry, media } from './constants.stylex';
import { SubHeading } from './heading';
import { colors } from './tokens.stylex';

const styles = stylex.create({
  link: {
    color: colors.text,
    textDecoration: 'underline',
    textUnderlineOffset: 3,
    overflowWrap: 'anywhere',
    outlineColor: {
      default: colors.focus,
      [media.forcedColors]: 'Highlight',
    },
    outlineOffset: 3,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
  },
  stack: { display: 'grid', gap: 16, minWidth: 0 },
  heading: { fontSize: '1.25rem', fontWeight: 500, lineHeight: 1.35 },
  text: { color: colors.textSecondary, maxWidth: '68ch' },
  mono: {
    fontFamily: fonts.mono,
    fontSize: '0.8125rem',
    overflowWrap: 'anywhere',
  },
  figure: { display: 'grid', gap: 12, alignContent: 'start', minWidth: 0 },
  imageLink: {
    display: 'block',
    borderColor: colors.borderControl,
    borderStyle: 'solid',
    borderWidth: 1,
    borderRadius: geometry.radius,
    backgroundColor: colors.surface,
  },
  image: {
    display: 'block',
    width: '100%',
    height: 'auto',
    borderRadius: geometry.radius,
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
  column: { backgroundColor: colors.surfaceMuted, fontWeight: 500 },
  nowrap: { whiteSpace: 'nowrap' },
  list: { display: 'grid', gap: 12, paddingInlineStart: 20, marginBlock: 0 },
  artifact: { paddingBlock: 4 },
  caption: {
    color: colors.textMuted,
    fontSize: '0.8125rem',
    overflowWrap: 'anywhere',
  },
  frame: { display: 'block', position: 'relative' },
  changeChip: {
    alignItems: 'center',
    backgroundColor: colors.changedFill,
    borderRadius: 4,
    color: colors.changed,
    display: 'inline-flex',
    fontSize: '0.8125rem',
    fontWeight: 500,
    gap: 6,
    paddingBlock: 2,
    paddingInline: 8,
    whiteSpace: 'nowrap',
  },
  changedRow: { backgroundColor: colors.surface },
  laneAxis: { stroke: colors.border },
  laneBefore: { fill: colors.textMuted },
  laneAfter: { fill: colors.text },
  compactList: {
    display: 'grid',
    gap: 12,
    listStyle: 'none',
    margin: 0,
    padding: 0,
  },
  compactRow: { display: 'grid', gap: 4, justifyItems: 'start' },
  unknownChip: { backgroundColor: colors.unknownFill, color: colors.unknown },
  dim: { color: colors.textMuted },
  summary: {
    alignItems: 'center',
    cursor: 'pointer',
    display: 'flex',
    gap: 8,
    minHeight: geometry.target,
    outlineColor: { default: colors.focus, [media.forcedColors]: 'Highlight' },
    outlineOffset: 3,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
  },
  sides: {
    display: 'grid',
    gap: 24,
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      [media.desktop]: 'repeat(2, minmax(0, 1fr))',
    },
  },
});

export function openSection(id: string) {
  const target = document.getElementById(id);

  if (target instanceof HTMLDetailsElement) {
    target.open = true;
  }
}

export const EvidenceUrls = createContext((href: string) => href);

export function EvidenceLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  const resolve = use(EvidenceUrls);

  return (
    <a href={resolve(href)} {...stylex.props(styles.link)}>
      {children}
    </a>
  );
}

export function Screenshot({ side, label }: { side: Side; label: string }) {
  const [failed, setFailed] = useState(false);
  const resolve = use(EvidenceUrls);
  const capture = side.capture?.manifest ?? null;

  return (
    <figure {...stylex.props(styles.figure)}>
      <SubHeading xstyle={styles.heading}>{label}</SubHeading>
      <p {...stylex.props(styles.caption)}>
        {capture?.label ?? 'No capture'}
        {capture === null ? null : (
          <>
            {' · '}
            <span
              title={describeRevision(capture.source.revision)}
              {...stylex.props(styles.mono)}
            >
              {shortSource(capture.source)}
            </span>
          </>
        )}
      </p>
      {side.screenshot === null ? (
        <p {...stylex.props(styles.missing)}>
          Screenshot unavailable. See unresolved evidence.
        </p>
      ) : (
        <a
          href={resolve(side.screenshot)}
          {...stylex.props(styles.link, styles.imageLink)}
        >
          {failed ? (
            <p {...stylex.props(styles.missing)}>
              Image could not be displayed. Open original screenshot.
            </p>
          ) : (
            <span {...stylex.props(styles.frame)}>
              <img
                src={resolve(side.screenshot)}
                alt={`${label} captured application. Open full-size screenshot.`}
                loading="eager"
                onError={() => setFailed(true)}
                {...stylex.props(styles.image)}
              />
            </span>
          )}
        </a>
      )}
    </figure>
  );
}

export function RequestLedger({ side, label }: { side: Side; label: string }) {
  const observations = side.execution === 'complete' ? side.observations : null;

  return (
    <section
      {...stylex.props(styles.stack)}
      aria-label={`${label} request ledger`}
    >
      <SubHeading xstyle={styles.heading}>{label}</SubHeading>
      {observations === null ? (
        <p {...stylex.props(styles.missing)}>Request evidence unavailable.</p>
      ) : (
        <>
          <p {...stylex.props(styles.text)}>
            Recorded window:{' '}
            <span {...stylex.props(styles.mono)}>
              {observations.window.startedAt} to{' '}
              {observations.window.finishedAt}
            </span>
          </p>
          {observations.requests.length === 0 ? (
            <p {...stylex.props(styles.text)}>
              No requests recorded in this window.
            </p>
          ) : (
            <div
              {...stylex.props(styles.scroll)}
              role="region"
              aria-label={`${label} requests, scroll horizontally for all columns`}
              tabIndex={0}
            >
              <table {...stylex.props(styles.table)}>
                <thead>
                  <tr>
                    {['Method', 'Path', 'Status', 'Timestamp (UTC)'].map(
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
                  {observations.requests.map((request, index) => (
                    <tr key={index}>
                      <td {...stylex.props(styles.cell, styles.mono)}>
                        {request.method}
                      </td>
                      <td {...stylex.props(styles.cell, styles.mono)}>
                        {request.origin === 'application' ? '' : request.origin}
                        {request.path}
                      </td>
                      <td {...stylex.props(styles.cell, styles.mono)}>
                        {describeStatus(request.status)}
                      </td>
                      <td
                        {...stylex.props(
                          styles.cell,
                          styles.mono,
                          styles.nowrap,
                        )}
                      >
                        <time dateTime={request.startedAt}>
                          {request.startedAt}
                        </time>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function Artifacts({ side, label }: { side: Side; label: string }) {
  return (
    <section
      {...stylex.props(styles.stack)}
      aria-label={`${label} original artifacts`}
    >
      <SubHeading xstyle={styles.heading}>{label}</SubHeading>
      {side.artifacts.length === 0 ? (
        <p {...stylex.props(styles.text)}>No artifacts available.</p>
      ) : (
        <ul {...stylex.props(styles.list)}>
          {side.artifacts.map((artifact, index) => (
            <li key={index} {...stylex.props(styles.artifact)}>
              {artifact.integrity === 'verified' ? (
                <EvidenceLink href={artifact.path}>{artifact.id}</EvidenceLink>
              ) : (
                artifact.id
              )}
              <p {...stylex.props(styles.text)}>{artifact.description}</p>
              <p {...stylex.props(styles.caption)}>
                Artifact integrity: {integrityLabels[artifact.integrity]}.
                {artifact.integrity === 'verified'
                  ? null
                  : ` ${artifact.reason}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const changeWords = {
  added: { symbol: '+', word: 'Added' },
  removed: { symbol: '−', word: 'Removed' },
  count: { symbol: 'Δ', word: 'Count changed' },
  status: { symbol: 'Δ', word: 'Status changed' },
  unknown: { symbol: '?', word: 'Status not recorded' },
  same: { symbol: '·', word: 'Unchanged' },
} satisfies Record<RequestChange, { symbol: string; word: string }>;

function describeStatuses(statuses: readonly number[]): string {
  if (statuses.length === 0) {
    return 'none';
  }

  const counts = new Map<number, number>();

  for (const status of statuses) {
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }

  return [...counts]
    .map(([status, count]) => `${count} × ${describeStatus(status)}`)
    .join(', ');
}

type Starts = {
  // Milliseconds from each side's recorded window start, per row key.
  readonly of: (row: RequestRow, side: 'base' | 'candidate') => number[];
  readonly span: number;
};

const laneWidth = 160;

function rowKey(row: Pick<RequestRow, 'method' | 'origin' | 'path'>): string {
  return JSON.stringify([row.method, row.origin, row.path]);
}

function StartLanes({ row, starts }: { row: RequestRow; starts: Starts }) {
  const x = (value: number) =>
    4 + (starts.span === 0 ? 0 : (value / starts.span) * (laneWidth - 8));
  const before = starts.of(row, 'base');
  const after = starts.of(row, 'candidate');
  const words = (label: string, values: number[]) =>
    values.length === 0
      ? `${label} none`
      : `${label} at ${values
          .slice(0, 10)
          .map((value) => `${Math.round(value)} ms`)
          .join(
            ', ',
          )}${values.length > 10 ? ` and ${values.length - 10} more` : ''}`;

  return (
    <svg
      viewBox={`0 0 ${laneWidth} 24`}
      width={laneWidth}
      height={24}
      role="img"
      aria-label={`Start times: ${words('Before', before)}; ${words('After', after)}`}
    >
      <line
        x1={0}
        x2={laneWidth}
        y1={12}
        y2={12}
        {...stylex.props(styles.laneAxis)}
      />
      {before.map((value, index) => (
        <circle
          key={`b${index}`}
          cx={x(value)}
          cy={6}
          r={3}
          {...stylex.props(styles.laneBefore)}
        />
      ))}
      {after.map((value, index) => (
        <rect
          key={`a${index}`}
          x={x(value) - 3}
          y={15}
          width={6}
          height={6}
          {...stylex.props(styles.laneAfter)}
        />
      ))}
    </svg>
  );
}

function RequestRows({
  label,
  rows,
  changes,
  starts,
}: {
  label: string;
  rows: readonly RequestRow[];
  changes: boolean;
  starts: Starts;
}) {
  const columns = [
    ...(changes ? ['Change'] : []),
    'Method',
    'Path',
    'Before',
    'After',
    'Start in window',
  ];

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
            {columns.map((column) => (
              <th
                key={column}
                scope="col"
                {...stylex.props(styles.cell, styles.column, styles.nowrap)}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.method} ${row.origin} ${row.path}`}
              {...stylex.props(changes && styles.changedRow)}
            >
              {changes ? (
                <td {...stylex.props(styles.cell)}>
                  <span
                    {...stylex.props(
                      styles.changeChip,
                      row.change === 'unknown' && styles.unknownChip,
                    )}
                  >
                    {changeLabel(row)}
                  </span>
                </td>
              ) : null}
              <td {...stylex.props(styles.cell, styles.mono)}>{row.method}</td>
              <th scope="row" {...stylex.props(styles.cell, styles.mono)}>
                {row.origin === 'application' ? '' : row.origin}
                {row.path}
              </th>
              <td
                {...stylex.props(
                  styles.cell,
                  styles.mono,
                  styles.nowrap,
                  row.base.length === 0 && styles.dim,
                )}
              >
                {describeStatuses(row.base)}
              </td>
              <td
                {...stylex.props(
                  styles.cell,
                  styles.mono,
                  styles.nowrap,
                  row.candidate.length === 0 && styles.dim,
                )}
              >
                {describeStatuses(row.candidate)}
              </td>
              <td {...stylex.props(styles.cell)}>
                <StartLanes row={row} starts={starts} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function changeLabel(row: RequestRow): string {
  const { symbol, word } = changeWords[row.change];
  const delta = row.candidate.length - row.base.length;

  return row.change === 'count'
    ? `${symbol} ${word} ${delta > 0 ? '+' : '−'}${Math.abs(delta)}`
    : `${symbol} ${word}`;
}

// The changed rows alone, one line each, for a narrow panel.
function CompactRows({ rows }: { rows: readonly RequestRow[] }) {
  return rows.length === 0 ? (
    <p {...stylex.props(styles.text)}>No request changed.</p>
  ) : (
    <ul
      aria-label="Requests that changed or have a status not recorded"
      {...stylex.props(styles.compactList)}
    >
      {rows.map((row) => (
        <li
          key={`${row.method} ${row.origin} ${row.path}`}
          {...stylex.props(styles.compactRow)}
        >
          <span
            {...stylex.props(
              styles.changeChip,
              row.change === 'unknown' && styles.unknownChip,
            )}
          >
            {changeLabel(row)}
          </span>
          <span {...stylex.props(styles.mono)}>
            {row.method} {row.origin === 'application' ? '' : row.origin}
            {row.path}
          </span>
          <span {...stylex.props(styles.mono)}>
            Before {describeStatuses(row.base)} · After{' '}
            {describeStatuses(row.candidate)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function RequestDiff({
  before,
  after,
  compact = false,
}: {
  before: Side;
  after: Side;
  compact?: boolean;
}) {
  if (before.execution !== 'complete' || after.execution !== 'complete') {
    return compact ? (
      <p {...stylex.props(styles.missing)}>
        Requests were not compared:{' '}
        {before.execution === 'complete' ? 'After' : 'Before'} capture did not
        complete.
      </p>
    ) : (
      <div {...stylex.props(styles.sides)}>
        <RequestLedger side={before} label="Before" />
        <RequestLedger side={after} label="After" />
      </div>
    );
  }

  const rows = requestDiff(
    before.observations.requests,
    after.observations.requests,
  );
  const listed = rows.filter((row) => row.change !== 'same');

  if (compact) {
    return <CompactRows rows={listed} />;
  }

  const offsets = (side: Side & { execution: 'complete' }) => {
    const start = Date.parse(side.observations.window.startedAt);
    const byRow = new Map<string, number[]>();

    for (const request of side.observations.requests) {
      const key = rowKey(request);

      byRow.set(key, [
        ...(byRow.get(key) ?? []),
        Date.parse(request.startedAt) - start,
      ]);
    }

    return {
      byRow,
      span: Date.parse(side.observations.window.finishedAt) - start,
    };
  };

  const beforeStarts = offsets(before);
  const afterStarts = offsets(after);
  const starts: Starts = {
    of: (row, side) =>
      (side === 'base' ? beforeStarts : afterStarts).byRow.get(rowKey(row)) ??
      [],
    span: Math.max(beforeStarts.span, afterStarts.span),
  };

  const changed = listed.filter((row) => row.change !== 'unknown');
  const unknown = listed.length - changed.length;
  const same = rows.filter((row) => row.change === 'same');
  const unchangedCount = same.reduce((sum, row) => sum + row.base.length, 0);

  return (
    <section {...stylex.props(styles.stack)} aria-label="Request ledger diff">
      <p {...stylex.props(styles.text)}>
        Before {plural(before.observations.requests.length, 'request')}, after{' '}
        {after.observations.requests.length}.{' '}
        {changed.length === 0
          ? 'No method, path, count or status changed.'
          : `${plural(changed.length, 'row')} changed.`}
        {unknown === 0
          ? ''
          : ` ${plural(unknown, 'row')} with a status not recorded.`}
      </p>
      {rows.length === 0 ? (
        <p {...stylex.props(styles.text)}>
          No requests recorded on either side.
        </p>
      ) : null}
      {listed.length === 0 ? null : (
        <RequestRows
          label="Changed requests"
          rows={listed}
          changes
          starts={starts}
        />
      )}
      {same.length === 0 ? null : (
        <details open={listed.length === 0}>
          <summary {...stylex.props(styles.summary)}>
            Unchanged: {plural(same.length, 'row')},{' '}
            {plural(unchangedCount, 'request')} per side
          </summary>
          <RequestRows
            label="Unchanged requests"
            rows={same}
            changes={false}
            starts={starts}
          />
        </details>
      )}
      <p {...stylex.props(styles.caption)}>
        Start in window: ● Before, ■ After, from each recorded window&apos;s
        start on one scale of {Math.round(starts.span)} ms. Response durations
        are not recorded.
      </p>
      <p {...stylex.props(styles.caption)}>
        Recorded windows: Before{' '}
        <span {...stylex.props(styles.mono)}>
          {before.observations.window.startedAt} to{' '}
          {before.observations.window.finishedAt}
        </span>
        , After{' '}
        <span {...stylex.props(styles.mono)}>
          {after.observations.window.startedAt} to{' '}
          {after.observations.window.finishedAt}
        </span>
        .
      </p>
    </section>
  );
}
