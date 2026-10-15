import { Schema } from 'effect';
import { expect, it } from 'vitest';
import { Agent } from './index';

it('accepts only the agents an adapter exists for', () => {
  expect(Schema.decodeUnknownSync(Agent)('codex')).toBe('codex');
  expect(() => Schema.decodeUnknownSync(Agent)('gpt')).toThrow();
});
