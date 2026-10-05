import { Schema } from 'effect';
import { text } from './capture/model';

export const relativePathSchema = text.check(
  Schema.makeFilter(
    (value) =>
      !value.startsWith('/') &&
      !/[\\:\p{Cc}]/u.test(value) &&
      value.split('/').every((part) => !['', '.', '..'].includes(part)),
  ),
);
