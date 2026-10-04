import * as stylex from '@stylexjs/stylex';
import {
  describeViewport,
  performanceMetrics,
  sampleDifference,
  summarize,
  type PerformanceMetric,
  type PerformanceValue,
} from '../../evidence-kinds/performance';
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
import type { SectionInput, SectionSide } from './define';
import { SamplePlot } from './sample-plot';

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
  plots: {
    display: 'grid',
    gap: 24,
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      [media.desktop]: 'repeat(2, minmax(0, 1fr))',
    },
  },
  plot: {
    alignContent: 'start',
    borderColor: colors.border,
    borderRadius: geometry.radius,
    borderStyle: 'solid',
    borderWidth: 1,
    display: 'grid',
    gap: 4,
    minWidth: 0,
    padding: 16,
  },
  changeRow: {
    borderTopColor: colors.border,
    borderTopStyle: 'solid',
    borderTopWidth: 1,
    columnGap: 12,
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingTop: 8,
  },
  chips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    listStyle: 'none',
    margin: 0,
    padding: 0,
  },
  chip: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 4,
    color: colors.textSecondary,
    fontFamily: fonts.mono,
    fontSize: '0.75rem',
    paddingBlock: 2,
    paddingInline: 8,
  },
  plotHeader: {
    alignItems: 'baseline',
    columnGap: 12,
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  summary: {
    cursor: 'pointer',
    fontWeight: 500,
    minHeight: geometry.target,
    paddingBlock: 10,
    outlineColor: { default: colors.focus, [media.forcedColors]: 'Highlight' },
    outlineOffset: 3,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
  },
});

// The recorded conditions as chips, beside the numbers they qualify.
function conditionChips(value: PerformanceValue, perSide: boolean): string[] {
  const { conditions } = value;

  return [
    `${conditions.samples} samples${perSide ? ' per side' : ''}`,
    `${conditions.warmup} warm-up discarded`,
    `viewport ${describeViewport(value)}`,
    `CPU ${conditions.cpu}`,
    `network ${conditions.network}`,
    `cache ${conditions.cache}`,
    `runs ${conditions.order}`,
  ];
}

// Whether the Before and After samples' min-to-max ranges overlap. This is
// an observation about the samples, not a confidence interval.
function rangesOverlap(
  base: PerformanceValue,
  candidate: PerformanceValue,
  metric: PerformanceMetric,
): boolean | null {
  const before = summarize(base, metric);
  const after = summarize(candidate, metric);

  if (before.kind !== 'measured' || after.kind !== 'measured') {
    return null;
  }

  return before.min <= after.max && after.min <= before.max;
}

function overlapText(overlap: boolean | null): string {
  if (overlap === null) {
    return '';
  }

  return overlap ? ' · ranges overlap' : ' · ranges do not overlap';
}

function measured(
  side: SectionSide<'performance'> | null,
  metric: PerformanceMetric,
): boolean {
  return (
    side?.evidence.status === 'recorded' &&
    side.evidence.value.samples.some(
      (sample) => !sample.warmup && sample.metrics[metric] !== null,
    )
  );
}

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

export function PerformanceSection({
  base: before,
  candidate: after,
  budgets = new Map(),
}: SectionInput<'performance'> & {
  budgets?: ReadonlyMap<PerformanceMetric, number | null>;
}) {
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
  const recordedBase = base?.status === 'recorded' ? base.value : null;
  const recordedCandidate =
    candidate.status === 'recorded' ? candidate.value : null;
  const comparable =
    recordedBase !== null &&
    recordedCandidate !== null &&
    sampleDifference(recordedBase, recordedCandidate) === null;
  const chipSource =
    comparable || recordedBase === null || recordedCandidate === null
      ? (recordedCandidate ?? recordedBase)
      : null;
  const inspected = [before, after].some(
    (side) =>
      side !== null && inspectionFiles(side.evidence, side.artifacts) !== null,
  );

  return (
    <div {...stylex.props(styles.stack)}>
      <p {...stylex.props(styles.text)}>{performanceClaimLimit}</p>
      {chipSource === null ? null : (
        <ul aria-label="Sample conditions" {...stylex.props(styles.chips)}>
          {conditionChips(chipSource, comparable).map((chip) => (
            <li key={chip} {...stylex.props(styles.chip)}>
              {chip}
            </li>
          ))}
        </ul>
      )}
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
      <p {...stylex.props(styles.caption)}>
        Each mark is one sample. The tall line is the median and the bar spans
        the lowest to the highest sample.
      </p>
      <div {...stylex.props(styles.plots)}>
        {performanceMetrics
          .filter(
            (metric) => measured(before, metric) || measured(after, metric),
          )
          .map((metric) => {
            const row = rows.find((item) => item.metric === metric);

            return row === undefined ? null : (
              <section
                key={metric}
                aria-label={`${row.abbreviation} samples`}
                {...stylex.props(styles.plot)}
              >
                <div {...stylex.props(styles.plotHeader)}>
                  <span {...stylex.props(styles.metric)}>
                    {row.abbreviation}
                    <span {...stylex.props(styles.metricName)}>
                      {row.label}
                    </span>
                  </span>
                </div>
                <SamplePlot
                  metric={metric}
                  budget={budgets.get(metric) ?? null}
                  base={base}
                  candidate={candidate}
                />
                {comparison ? (
                  <p {...stylex.props(styles.changeRow)}>
                    <span>Change in median</span>
                    <span {...stylex.props(styles.number)}>
                      {row.change}
                      {comparable
                        ? overlapText(
                            rangesOverlap(
                              recordedBase,
                              recordedCandidate,
                              metric,
                            ),
                          )
                        : ''}
                    </span>
                  </p>
                ) : null}
              </section>
            );
          })}
      </div>
      <details>
        <summary {...stylex.props(styles.summary)}>
          Medians and ranges for every metric
        </summary>
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
                    <span {...stylex.props(styles.metricName)}>
                      {row.label}
                    </span>
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
      </details>
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
}
