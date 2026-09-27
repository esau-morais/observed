import { Schema } from 'effect';
import { text, timestamp } from '../capture/model';
import { defineEvidence } from './define';

const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

// agent-browser 0.38.1 reports errors and console messages without times, so
// each entry names the step after which it was first read. It arrived after
// the previous read started and before this read finished. `step` is null
// before the first step.
export const browserErrors = defineEvidence({
  kind: 'browser-errors',
  title: 'Browser errors',
  schemaVersion: 1,
  collector: {},
  value: Schema.Struct({
    steps: count,
    coverage: Schema.Union([
      Schema.Struct({ kind: Schema.Literal('complete') }),
      Schema.Struct({ kind: Schema.Literal('incomplete'), reason: text }),
    ]),
    entries: Schema.Array(
      Schema.Struct({
        source: Schema.Literals(['page', 'console']),
        text: Schema.String,
        step: Schema.NullOr(count),
        after: Schema.NullOr(timestamp),
        seenAt: timestamp,
      }),
    ),
  }).check(
    Schema.makeFilter(
      (value) =>
        value.entries.every(
          (entry) =>
            (entry.step === null) === (entry.after === null) &&
            (entry.step === null || entry.step < value.steps) &&
            (entry.after === null || entry.after <= entry.seenAt),
        ),
      {
        message: 'Error entries must name a recorded step and a valid interval',
      },
    ),
  ),
});
