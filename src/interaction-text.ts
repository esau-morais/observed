import type { Step } from './capture/recipe';
import type { EvidenceValue } from './evidence-kinds';
import { statusWords } from './status-words';

type TimelineStep = EvidenceValue<'timeline'>['steps'][number];
type BrowserErrors = EvidenceValue<'browser-errors'>;
type BrowserError = BrowserErrors['entries'][number];

const actions = {
  navigate: 'Navigate',
  click: 'Click',
  'click-role': 'Click by role',
  fill: 'Fill',
  press: 'Press',
  'wait-text': 'Wait for text',
  'wait-selector': 'Wait for element',
  'network-idle': 'Wait for network idle',
} satisfies Record<Step['kind'], string>;

const actionLabels = new Map<string, string>(Object.entries(actions));

export function describeAction(action: string): string {
  return actionLabels.get(action) ?? action;
}

export const stepOutcomeLabels = {
  completed: 'Completed',
  failed: 'Step failed',
  'not-run': statusWords.notRun.word,
} satisfies Record<TimelineStep['outcome'], string>;

export function describeDuration(step: TimelineStep): string {
  if (step.outcome === 'not-run') {
    return statusWords.notRun.word;
  }

  const milliseconds = Date.parse(step.finishedAt) - Date.parse(step.startedAt);

  return milliseconds < 1000
    ? `${milliseconds} ms`
    : `${(milliseconds / 1000).toFixed(2)} s`;
}

export const errorSourceLabels = {
  page: 'Uncaught page error',
  console: 'Console error',
} satisfies Record<BrowserError['source'], string>;

const clock = (time: string) => time.slice(11, 23);

export function describeErrorTime(error: BrowserError): string {
  if (error.step === null || error.after === null) {
    return `Read before the first step, reported by ${clock(error.seenAt)} UTC`;
  }

  return `Read after step ${error.step + 1}, reported between ${clock(error.after)} and ${clock(error.seenAt)} UTC`;
}

export function describeErrorCoverage(record: BrowserErrors): string {
  return record.coverage.kind === 'complete'
    ? 'Read after every step and once more after the final snapshot. agent-browser gives no error times, so each time is the interval in which agent-browser reported the error.'
    : `Incomplete: ${record.coverage.reason}.`;
}
