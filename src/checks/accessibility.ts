import { Schema } from 'effect';
import {
  defaultImpact,
  evaluateAccessibility,
  impactSchema,
} from '../accessibility';
import { text as nonEmpty } from '../capture/model';
import { defineCheck } from './define';

const definition = Schema.Struct({
  kind: Schema.Literal('accessibility'),
  id: nonEmpty,
  name: nonEmpty,
  scope: nonEmpty,
  impact: Schema.optionalKey(impactSchema),
});

export const accessibility = defineCheck({
  definition,
  evidence: ['accessibility'],
  needsBase: true,
  collectors: () => [{ kind: 'accessibility' }],
  expectation: (check) =>
    `No new ${check.impact ?? defaultImpact} or higher axe-core violations compared with base.`,
  evaluate: ({ definition: check, base, candidate }) =>
    evaluateAccessibility({
      threshold: check.impact ?? defaultImpact,
      base: base?.evidence.accessibility ?? null,
      candidate: candidate.evidence.accessibility,
    }),
});
