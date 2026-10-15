import { Schema } from 'effect';
import { expect, it } from 'vitest';
import { Journey } from './index';

it('rejects a journey with no steps', () => {
  expect(() => Schema.decodeUnknownSync(Journey)({ name: 'checkout', steps: [] })).toThrow();
});
