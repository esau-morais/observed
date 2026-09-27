import { Schema } from 'effect';
import { text } from '../capture/model';
import type { EvidenceValue } from '../evidence-kinds';
import { defineCheck, perSide } from './define';

type ErrorRecord = EvidenceValue<'browser-errors'>;
type BrowserError = ErrorRecord['entries'][number];

type StepError = BrowserError & { step: number };

const ignorePattern = text.check(
  Schema.makeFilter(
    (value) => {
      try {
        new RegExp(value);

        return true;
      } catch {
        return false;
      }
    },
    { message: 'Expected a valid JavaScript regular expression' },
  ),
);

const definition = Schema.Struct({
  kind: Schema.Literal('browser-errors'),
  id: text,
  name: text,
  scope: text,
  ignore: Schema.optionalKey(Schema.Array(ignorePattern)),
});

type Definition = typeof definition.Type;

function sourceLabel(error: BrowserError): string {
  return error.source === 'page' ? 'page error' : 'console error';
}

function message(error: BrowserError): string {
  return error.text.split('\n')[0] ?? '';
}

// The application listens on a new port for every capture, so a message that
// names it would otherwise never match between base and candidate.
function signature(error: BrowserError): string {
  const line = message(error)
    .replaceAll(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+/g, '<application>')
    .trim();

  return `${sourceLabel(error)}: ${line === '' ? '(empty message)' : line}`;
}

function describe(errors: readonly StepError[]): string {
  const shown = errors
    .slice(0, 3)
    .map((error) => `step ${error.step + 1} ${signature(error)}`)
    .join('; ');

  return errors.length > 3 ? `${shown}; and ${errors.length - 3} more` : shown;
}

function classify(check: Definition, record: ErrorRecord) {
  const patterns = (check.ignore ?? []).map((pattern) => new RegExp(pattern));
  const during = record.entries.filter(
    (error): error is StepError => error.step !== null,
  );
  const ignored = during.filter((error) =>
    patterns.some((pattern) => pattern.test(message(error))),
  );

  return {
    counted: during.filter((error) => !ignored.includes(error)),
    ignored: ignored.length,
    before: record.entries.length - during.length,
  };
}

export const browserErrors = defineCheck({
  definition,
  evidence: ['browser-errors'],
  // One side's errors are a complete verdict; the base only decides whether a
  // failure is a regression.
  needsBase: () => false,
  collectors: () => [{ kind: 'browser-errors' }],
  expectation: (check) => {
    const ignore = check.ignore ?? [];

    return ignore.length === 0
      ? 'No uncaught page errors or console errors during the recorded steps.'
      : `No uncaught page errors or console errors during the recorded steps, except messages matching ${ignore.map((pattern) => JSON.stringify(pattern)).join(', ')}.`;
  },
  evaluate: perSide((check, { evidence }) => {
    const record = evidence['browser-errors'];

    if (record.coverage.kind === 'incomplete') {
      return {
        outcome: 'unknown',
        actual: null,
        detail: `Error record incomplete: ${record.coverage.reason}.`,
      };
    }

    if (record.steps === 0) {
      return {
        outcome: 'unknown',
        actual: null,
        detail: 'No steps are configured, so no errors were checked.',
      };
    }

    const { counted, ignored, before } = classify(check, record);
    const notes = [
      ignored === 0 ? '' : ` ${ignored} ignored by pattern.`,
      before === 0 ? '' : ` ${before} before the first step, not checked.`,
    ].join('');

    return counted.length === 0
      ? {
          outcome: 'passed',
          actual: 0,
          detail: `No page or console errors during ${record.steps} step(s).${notes}`,
        }
      : {
          outcome: 'failed',
          actual: counted.length,
          detail: `${counted.length} error(s) during ${record.steps} step(s): ${describe(counted)}.${notes}`,
        };
  }),
  // A regression is an error the base did not have, even when the base
  // already failed with other errors.
  regression: ({ definition: check, base, candidate }) => {
    if (candidate.evaluation.outcome !== 'failed') {
      return null;
    }

    const known = new Set(
      classify(check, base.evidence['browser-errors']).counted.map(signature),
    );
    const added = classify(
      check,
      candidate.evidence['browser-errors'],
    ).counted.filter((error) => !known.has(signature(error)));

    return added.length === 0
      ? null
      : {
          detail: `${check.name}: ${added.length} error(s) on the candidate that the base did not have: ${describe(added)}. Base: ${String(base.evaluation.actual)}; candidate: ${String(candidate.evaluation.actual)}.`,
        };
  },
});
