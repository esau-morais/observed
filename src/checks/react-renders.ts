import { Schema } from 'effect';
import { text } from '../capture/model';
import { renderCount, type ReactEvidence } from '../evidence-kinds/react';
import { defineCheck, type Evaluation } from './define';

const definition = Schema.Struct({
  kind: Schema.Literal('react-renders'),
  id: text,
  name: text,
  scope: text,
  component: text,
  maxRenders: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

type ReactRendersCheck = typeof definition.Type;

export function evaluateReactRenders(
  check: ReactRendersCheck,
  value: ReactEvidence,
): Evaluation {
  const renders = renderCount(value, check.component);

  if (renders === null) {
    return {
      outcome: 'unknown',
      actual: null,
      detail:
        value.truncated.components || value.truncated.mounted
          ? `${check.component} is not among the recorded components, and the recording reached its component limit.`
          : `No mounted component is named ${check.component}. Production builds can rename components; the recorded names are listed with the React evidence.`,
    };
  }

  const entry = value.components.find((item) => item.name === check.component);

  return {
    outcome: renders <= check.maxRenders ? 'passed' : 'failed',
    actual: renders,
    detail:
      entry === undefined
        ? `${check.component} was mounted and did not render during steps.`
        : `${check.component} rendered ${renders} time(s) across ${value.commits} commit(s): ${entry.mounts} mount(s) and ${entry.updates} update(s), summed over every instance with that name.`,
  };
}

export const reactRenders = defineCheck({
  definition,
  evidence: ['react'],
  collectors: () => [{ kind: 'react' }],
  expectation: (check) =>
    `${check.component} renders at most ${check.maxRenders} time(s) during the journey's steps. A render counts when React commits work for the component, as React DevTools highlights it; renders React discards after bailing out are not counted.`,
  evaluate: ({ definition: check, base, candidate }) => {
    const before =
      base === null ? null : evaluateReactRenders(check, base.evidence.react);
    const after = evaluateReactRenders(check, candidate.evidence.react);

    if (
      typeof before?.actual !== 'number' ||
      typeof after.actual !== 'number'
    ) {
      return { base: before, candidate: after };
    }

    const added = after.actual - before.actual;

    return {
      base: before,
      candidate: {
        ...after,
        detail: `${check.component} renders: ${before.actual} before, ${after.actual} after (${added > 0 ? '+' : ''}${added}). ${after.detail}`,
      },
    };
  },
});
