import * as stylex from '@stylexjs/stylex';
import type { EvidenceView } from '../../evidence-kinds';
import {
  formatMetric,
  metricAbbreviations,
  sampleDifference,
  summarize,
  type PerformanceMetric,
  type PerformanceValue,
} from '../../evidence-kinds/performance';
import { fonts } from '../constants.stylex';
import { colors } from '../tokens.stylex';

const width = 520;
const left = 88;
const right = 24;
const laneGap = 36;
const dot = 8;

const styles = stylex.create({
  figure: { display: 'grid', gap: 8, margin: 0, minWidth: 0 },
  svg: { display: 'block', height: 'auto', maxWidth: 720, width: '100%' },
  axis: { stroke: colors.border },
  tick: {
    fill: colors.textMuted,
    fontFamily: fonts.mono,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
  },
  lane: { fill: colors.textSecondary, fontFamily: fonts.sans, fontSize: 14 },
  base: { fill: colors.textMuted },
  candidate: { fill: colors.text },
  range: { stroke: colors.borderControl, strokeWidth: 2 },
  median: { stroke: colors.textSecondary, strokeWidth: 3 },
  budget: { stroke: colors.textSecondary, strokeDasharray: '4 3' },
  budgetLabel: {
    fill: colors.textSecondary,
    fontFamily: fonts.mono,
    fontSize: 11,
  },
  caption: { color: colors.textMuted, fontSize: '0.8125rem' },
});

type Lane = {
  label: string;
  shape: 'circle' | 'square';
  values: readonly number[];
};

function samples(value: PerformanceValue, metric: PerformanceMetric) {
  return value.samples
    .filter((sample) => !sample.warmup)
    .map((sample) => sample.metrics[metric])
    .filter((item) => item !== null);
}

function scale(max: number): readonly number[] {
  const raw = max / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10]
      .map((factor) => factor * power)
      .find((item) => item >= raw) ?? raw;

  return [0, 1, 2, 3, 4].map((index) => index * step);
}

function tickLabel(
  metric: PerformanceMetric,
  value: number,
  last: boolean,
): string {
  if (metric === 'cls') {
    return String(Number(value.toFixed(3)));
  }

  const number = String(Number(value.toFixed(1)));

  return last ? `${number} ms` : number;
}

function describeLane(
  lane: Lane,
  metric: PerformanceMetric,
  value: PerformanceValue,
) {
  const summary = summarize(value, metric);

  return summary.kind === 'measured'
    ? `${lane.label}: ${lane.values.length} samples, median ${formatMetric(metric, summary.median)}, range ${formatMetric(metric, summary.min)} to ${formatMetric(metric, summary.max)}`
    : `${lane.label}: ${summary.reason}`;
}

function sampleCounts(sides: readonly Lane[]): string {
  const [first, ...rest] = sides;

  if (first === undefined) {
    return '';
  }

  return rest.every((side) => side.values.length === first.values.length)
    ? `n=${first.values.length}${rest.length === 0 ? '' : ' per side'}`
    : sides
        .map((side) => `n=${side.values.length} ${side.label.toLowerCase()}`)
        .join(', ');
}

// Every sample as a mark on a shared axis, so a small local sample shows its
// spread instead of one number.
export function SamplePlot({
  metric,
  budget,
  base,
  candidate,
}: {
  metric: PerformanceMetric;
  budget: number | null;
  base: EvidenceView<'performance'> | null;
  candidate: EvidenceView<'performance'>;
}) {
  const sides = [
    ...(base?.status === 'recorded'
      ? [{ label: 'Before', shape: 'circle' as const, value: base.value }]
      : []),
    ...(candidate.status === 'recorded'
      ? [
          {
            label: base === null ? 'Capture' : 'After',
            shape: 'square' as const,
            value: candidate.value,
          },
        ]
      : []),
  ].map((side) => ({ ...side, values: samples(side.value, metric) }));

  if (sides.length === 0 || sides.every((side) => side.values.length === 0)) {
    return null;
  }

  const largest = Math.max(
    ...sides.flatMap((side) => side.values),
    budget ?? 0,
  );
  const ticks = scale(largest === 0 ? 1 : largest * 1.05);
  const top = ticks.at(-1) ?? 1;
  const x = (value: number) => left + (value / top) * (width - left - right);
  const axisY = 28 + sides.length * laneGap;
  const height = axisY + 28;
  const abbreviation = metricAbbreviations[metric];
  const first = sides[0];
  const conditions = first?.value.conditions;
  const [firstLane, secondLane] = sides;
  const difference =
    firstLane === undefined || secondLane === undefined
      ? null
      : sampleDifference(firstLane.value, secondLane.value);
  const label = [
    `${abbreviation} samples.`,
    ...sides.map((side) => `${describeLane(side, metric, side.value)}.`),
    ...(budget === null ? [] : [`Budget ${formatMetric(metric, budget)}.`]),
  ].join(' ');

  return (
    <figure {...stylex.props(styles.figure)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={label}
        {...stylex.props(styles.svg)}
      >
        <line
          x1={left}
          x2={width - right}
          y1={axisY}
          y2={axisY}
          {...stylex.props(styles.axis)}
        />
        {ticks.map((tick) => (
          <text
            key={tick}
            x={x(tick)}
            y={axisY + 18}
            textAnchor="middle"
            {...stylex.props(styles.tick)}
          >
            {tickLabel(metric, tick, tick === top)}
          </text>
        ))}
        {budget === null ? null : (
          <>
            <line
              x1={x(budget)}
              x2={x(budget)}
              y1={12}
              y2={axisY}
              {...stylex.props(styles.budget)}
            />
            <text
              x={x(budget) + 4}
              y={20}
              {...stylex.props(styles.budgetLabel)}
            >
              budget {formatMetric(metric, budget)}
            </text>
          </>
        )}
        {sides.map((side, lane) => {
          const y = 36 + lane * laneGap;
          const placed: number[] = [];
          const summary = summarize(side.value, metric);

          return (
            <g key={side.label}>
              <text x={0} y={y + 4} {...stylex.props(styles.lane)}>
                {side.label}
              </text>
              {summary.kind === 'measured' ? (
                <>
                  <line
                    x1={x(summary.min)}
                    x2={x(summary.max)}
                    y1={y}
                    y2={y}
                    {...stylex.props(styles.range)}
                  />
                  <line
                    x1={x(summary.median)}
                    x2={x(summary.median)}
                    y1={y - 12}
                    y2={y + 12}
                    {...stylex.props(styles.median)}
                  />
                </>
              ) : null}
              {side.values.map((value, index) => {
                const cx = x(value);
                const stacked = placed.filter(
                  (other) => Math.abs(other - cx) < dot,
                ).length;
                const cy =
                  y + (stacked % 2 === 0 ? 1 : -1) * Math.ceil(stacked / 2) * 5;

                placed.push(cx);

                return side.shape === 'circle' ? (
                  <circle
                    key={index}
                    cx={cx}
                    cy={cy}
                    r={dot / 2}
                    {...stylex.props(styles.base)}
                  />
                ) : (
                  <rect
                    key={index}
                    x={cx - dot / 2}
                    y={cy - dot / 2}
                    width={dot}
                    height={dot}
                    {...stylex.props(styles.candidate)}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>
      {conditions === undefined || first === undefined ? null : (
        <figcaption {...stylex.props(styles.caption)}>
          {sampleCounts(sides)}
          {difference === 'conditions'
            ? ' · sample conditions differ between sides'
            : ''}
          {difference === 'page' ? ' · the sides sampled different pages' : ''}
        </figcaption>
      )}
    </figure>
  );
}
