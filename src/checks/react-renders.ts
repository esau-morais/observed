import { Schema } from 'effect';
import { text } from '../capture/model';
import { renderCount, type ReactEvidence } from '../evidence-kinds/react';
import { defineCheck, type Evaluation } from './define';

const definition = Schema.Struct({
  kind: Schema.Literal('react-renders'),
  id: text,
  name: text,
  scope: text,
  component: text.check(
    Schema.makeFilter((value) => value !== 'Anonymous', {
      message:
        'Anonymous sums every unnamed component; name the component in code',
    }),
  ),
  maxRenders: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

type ReactRendersCheck = typeof definition.Type;

export function evaluateReactRenders(
  check: ReactRendersCheck,
  value: ReactEvidence,
): Evaluation {
  const entry = value.components.find((item) => item.name === check.component);

  if (entry !== undefined) {
    const renders = entry.mounts + entry.updates;

    return {
      outcome: renders <= check.maxRenders ? 'passed' : 'failed',
      actual: renders,
      detail: `${check.component} rendered ${renders} time(s) across ${value.commits} commit(s): ${entry.mounts} mount(s) and ${entry.updates} update(s), summed over every instance with that name.`,
    };
  }

  if (renderCount(value, check.component) === 0) {
    return {
      outcome: 'passed',
      actual: 0,
      detail: `${check.component} was mounted and did not render during steps.`,
    };
  }

  return {
    outcome: 'unknown',
    actual: null,
    detail:
      value.truncated.components || value.truncated.mounted
        ? `${check.component} is not among the recorded components, and the recording reached its component limit.`
        : `No mounted component is named ${check.component}. Production builds can rename components; the recorded names are listed with the React evidence.`,
  };
}

function describeRenderers(value: ReactEvidence): string {
  return value.renderers.length === 0
    ? 'no React renderer'
    : value.renderers
        .map(
          (renderer) =>
            `React ${renderer.version ?? 'version unknown'} ${renderer.build}`,
        )
        .join(', ');
}

// Counts from different React versions or builds can differ without a code
// change, so a failure then is not attributed to the candidate.
function sameReact(base: ReactEvidence, candidate: ReactEvidence): boolean {
  return describeRenderers(base) === describeRenderers(candidate);
}

const expectation = (check: ReactRendersCheck) =>
  `${check.component} renders at most ${check.maxRenders} time(s) during the journey's steps. A render counts when React commits work for the component, as React DevTools highlights it; renders React discards after bailing out are not counted.`;

export const reactRenders = defineCheck({
  definition,
  evidence: ['react'],
  collectors: () => [{ kind: 'react' }],
  expectation,
  measure: (check) => ({
    label: `${check.component} renders`,
    limit: `at most ${check.maxRenders}`,
  }),
  evaluate: ({ definition: check, base, candidate, comparable }) => {
    const before =
      base === null ? null : evaluateReactRenders(check, base.evidence.react);
    const after = evaluateReactRenders(check, candidate.evidence.react);

    if (
      !comparable ||
      base === null ||
      typeof before?.actual !== 'number' ||
      typeof after.actual !== 'number'
    ) {
      return { base: before, candidate: after };
    }

    const added = after.actual - before.actual;
    const builds = sameReact(base.evidence.react, candidate.evidence.react)
      ? ''
      : ` Base ran ${describeRenderers(base.evidence.react)} and candidate ran ${describeRenderers(candidate.evidence.react)}, so the difference is not attributed to the code change.`;

    return {
      base: before,
      candidate: {
        ...after,
        detail: `${check.component} renders: ${before.actual} before, ${after.actual} after (${added > 0 ? '+' : ''}${added}).${builds} ${after.detail}`,
      },
    };
  },
  regression: ({ definition: check, base, candidate }) =>
    base.evaluation.outcome === 'passed' &&
    candidate.evaluation.outcome === 'failed' &&
    sameReact(base.evidence.react, candidate.evidence.react)
      ? {
          detail: `${check.name} passed on base and failed on candidate under the same React build. Base: ${base.evaluation.actual ?? 'none'}; candidate: ${candidate.evaluation.actual ?? 'none'}. ${expectation(check)}`,
        }
      : null,
});
