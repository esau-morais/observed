import type { EvidenceValue } from './evidence-kinds';

type TimelineStep = EvidenceValue<'timeline'>['steps'][number];
type BrowserErrors = EvidenceValue<'browser-errors'>;
type BrowserError = BrowserErrors['entries'][number];

const actions: Record<string, string> = {
  navigate: 'Navigate',
  click: 'Click',
  'click-role': 'Click by role',
  fill: 'Fill',
  press: 'Press',
  'wait-text': 'Wait for text',
  'wait-selector': 'Wait for element',
  'network-idle': 'Wait for network idle',
};

export function describeAction(action: string): string {
  return actions[action] ?? action;
}

export const stepOutcomeLabels = {
  completed: 'Completed',
  failed: 'Failed',
  'not-run': 'Not run',
} satisfies Record<TimelineStep['outcome'], string>;

export function describeDuration(step: TimelineStep): string {
  if (step.outcome === 'not-run') {
    return 'Not run';
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
    return `Before the first step, read by ${clock(error.seenAt)} UTC`;
  }

  return `Step ${error.step + 1}, between ${clock(error.after)} and ${clock(error.seenAt)} UTC`;
}

export function describeErrorCoverage(record: BrowserErrors): string {
  return record.coverage.kind === 'complete'
    ? 'Read after every step and at the end of the recorded window. agent-browser gives no error times, so each time is the interval between two reads.'
    : `Incomplete: ${record.coverage.reason}.`;
}
