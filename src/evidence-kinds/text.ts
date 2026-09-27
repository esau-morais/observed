import { Schema } from 'effect';
import { text as nonEmpty } from '../capture/model';
import { defineEvidence } from './define';

export const text = defineEvidence({
  kind: 'text',
  title: 'Element text',
  schemaVersion: 1,
  collector: {
    selectors: Schema.NonEmptyArray(nonEmpty).check(Schema.isUnique()),
  },
  value: Schema.Struct({
    elements: Schema.Array(
      Schema.Struct({
        selector: nonEmpty,
        count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
        value: Schema.NullOr(Schema.String),
      }),
    ),
  }),
});
