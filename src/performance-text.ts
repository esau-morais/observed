import type { SideArtifact } from './comparison-model';
import type { EvidenceView } from './evidence-kinds';
import {
  describeViewport,
  formatMetric,
  metricAbbreviations,
  metricLabels,
  performanceMetrics,
  sampleDifference,
  sampledPages,
  summarize,
  type PerformanceMetric,
  type PerformanceValue,
  type Recording,
} from './evidence-kinds/performance';
import { statusWords } from './status-words';

type PerformanceView = EvidenceView<'performance'>;

export type PerformanceCell =
  | { kind: 'measured'; median: string; range: string }
  | { kind: 'missing'; text: string };

type PerformanceRow = {
  metric: PerformanceMetric;
  label: string;
  abbreviation: string;
  base: PerformanceCell | null;
  candidate: PerformanceCell;
  change: string;
};

export type InspectionFile =
  { kind: 'recorded'; path: string } | { kind: 'unavailable'; reason: string };

export const performanceClaimLimit =
  'Local samples from this run, not production percentiles. A changed value is an observation; only a configured budget check decides pass or fail.';

export const inspectionNote =
  'For inspection only. Each file records one extra run after the samples, slowed by the recording itself, and is not a sample.';

function recorded(view: PerformanceView | null): PerformanceValue | null {
  return view?.status === 'recorded' ? view.value : null;
}

function cell(
  view: PerformanceView,
  metric: PerformanceMetric,
): PerformanceCell {
  if (view.status === 'unavailable') {
    return { kind: 'missing', text: statusWords.unavailable.word };
  }

  const summary = summarize(view.value, metric);

  if (summary.kind === 'unmeasured') {
    return { kind: 'missing', text: summary.reason };
  }

  return {
    kind: 'measured',
    median: formatMetric(metric, summary.median),
    range: `${formatMetric(metric, summary.min)} to ${formatMetric(metric, summary.max)}`,
  };
}

function signOf(difference: number): string {
  if (difference > 0) {
    return '+';
  }

  return difference < 0 ? '−' : '±';
}

function change(
  base: PerformanceValue | null,
  candidate: PerformanceValue | null,
  metric: PerformanceMetric,
): string {
  if (base === null || candidate === null) {
    return 'Not compared';
  }

  const difference = sampleDifference(base, candidate);

  if (difference !== null) {
    return difference === 'page'
      ? 'Not compared: different pages'
      : 'Not compared: conditions differ';
  }

  const before = summarize(base, metric);
  const after = summarize(candidate, metric);

  if (before.kind !== 'measured' || after.kind !== 'measured') {
    return 'Not compared';
  }

  const delta = after.median - before.median;
  const sign = signOf(delta);
  const amount = `${sign}${formatMetric(metric, Math.abs(delta))}`;

  return before.median === 0
    ? amount
    : `${amount} (${sign}${Math.abs((delta / before.median) * 100).toFixed(1)}%)`;
}

export function performanceRows(
  base: PerformanceView | null,
  candidate: PerformanceView,
): PerformanceRow[] {
  return performanceMetrics.map((metric) => ({
    metric,
    label: metricLabels[metric],
    abbreviation: metricAbbreviations[metric],
    base: base === null ? null : cell(base, metric),
    candidate: cell(candidate, metric),
    change: change(recorded(base), recorded(candidate), metric),
  }));
}

function describeSide(value: PerformanceValue, perSide: boolean): string {
  const { samples, warmup } = value.conditions;

  return `${samples} samples${perSide ? ' per side' : ''} on ${sampledPages(value)}, after ${warmup} discarded warm-up ${warmup === 1 ? 'run' : 'runs'}. Viewport ${describeViewport(value)}.`;
}

function span(value: PerformanceValue): { start: string; end: string } {
  const [first, ...rest] = value.samples;

  return rest.reduce(
    (range, sample) => ({
      start: sample.startedAt < range.start ? sample.startedAt : range.start,
      end: sample.finishedAt > range.end ? sample.finishedAt : range.end,
    }),
    { start: first.startedAt, end: first.finishedAt },
  );
}

function order(base: PerformanceValue, candidate: PerformanceValue): string {
  const before = span(base);
  const after = span(candidate);

  if (before.end <= after.start) {
    return 'Base samples ran before candidate samples, not interleaved, so drift between the two runs is not controlled.';
  }

  if (after.end <= before.start) {
    return 'Candidate samples ran before base samples, not interleaved, so drift between the two runs is not controlled.';
  }

  return 'Base and candidate sample times overlap.';
}

export function describeConditions(
  base: PerformanceView | null,
  candidate: PerformanceView,
): string {
  const before = recorded(base);
  const after = recorded(candidate);
  const common =
    'CPU and network unthrottled, browser cache warm. All runs on a side share one browser session, separate from the journey capture and without DevTools tracing or React instrumentation. Each run loads the page again and repeats the journey.';

  if (before !== null && after !== null) {
    return sampleDifference(before, after) === null
      ? `${describeSide(after, true)} ${common} ${order(before, after)}`
      : `Samples differ. Before: ${describeSide(before, false)} After: ${describeSide(after, false)} ${common}`;
  }

  const only = after ?? before;

  return only === null
    ? 'No timing samples were recorded.'
    : `${describeSide(only, false)} ${common}`;
}

function inspectionFile(
  recording: Recording,
  artifacts: readonly SideArtifact[],
): InspectionFile {
  if (recording.kind === 'unavailable') {
    return recording;
  }

  const artifact = artifacts.find((item) => item.id === recording.artifact);

  if (artifact === undefined) {
    return { kind: 'unavailable', reason: 'The file is not in the capture' };
  }

  return artifact.integrity === 'verified'
    ? { kind: 'recorded', path: artifact.path }
    : { kind: 'unavailable', reason: artifact.reason };
}

export function inspectionFiles(
  view: PerformanceView,
  artifacts: readonly SideArtifact[],
): { trace: InspectionFile; profile: InspectionFile } | null {
  if (
    view.status !== 'recorded' ||
    view.value.inspection.kind === 'not-requested'
  ) {
    return null;
  }

  const { trace, profile } = view.value.inspection;

  return {
    trace: inspectionFile(trace, artifacts),
    profile: inspectionFile(profile, artifacts),
  };
}
