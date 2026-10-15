import { Schema } from 'effect';

export const Journey = Schema.Struct({
  name: Schema.NonEmptyString,
  steps: Schema.NonEmptyArray(Schema.String),
});
export type Journey = typeof Journey.Type;
export * from './store/store';
