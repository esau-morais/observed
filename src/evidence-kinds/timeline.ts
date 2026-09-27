import { Schema } from 'effect';
import { text, timestamp } from '../capture/model';
import { defineEvidence } from './define';

const index = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const step = { index, action: text, target: Schema.NullOr(Schema.String) };

export const timeline = defineEvidence({
  kind: 'timeline',
  title: 'Steps and resulting state',
  schemaVersion: 1,
  collector: {},
  value: Schema.Struct({
    steps: Schema.Array(
      Schema.Union([
        Schema.Struct({
          ...step,
          outcome: Schema.Literals(['completed', 'failed']),
          startedAt: timestamp,
          finishedAt: timestamp,
        }),
        Schema.Struct({ ...step, outcome: Schema.Literal('not-run') }),
      ]),
    ),
    finalState: Schema.Union([
      Schema.Struct({ kind: Schema.Literal('recorded'), tree: Schema.String }),
      Schema.Struct({ kind: Schema.Literal('unavailable'), reason: text }),
    ]),
  }),
});
