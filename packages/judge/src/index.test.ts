import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import { combine, Verdict } from './index';

describe('combine', () => {
  it('keeps a result unknown when any check lacks evidence', () => {
    expect(combine(['holds', 'unknown', 'holds'])).toBe('unknown');
    expect(combine([])).toBe('unknown');
  });

  it('rejects a verdict the judge does not define', () => {
    expect(() => Schema.decodeUnknownSync(Verdict)('pass')).toThrow();
  });
});
