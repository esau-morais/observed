import { Schema } from 'effect';
import { text as nonEmpty } from '../capture/model';
import { defineCheck, perSide } from './define';

const definition = Schema.Struct({
  kind: Schema.Literal('text'),
  id: nonEmpty,
  name: nonEmpty,
  scope: nonEmpty,
  selector: nonEmpty,
  expectedText: Schema.String,
});

export const text = defineCheck({
  definition,
  evidence: ['text'],
  collectors: (checks) => {
    const [first, ...rest] = [...new Set(checks.map((check) => check.selector))];

    return first === undefined
      ? []
      : [{ kind: 'text', selectors: [first, ...rest] }];
  },
  expectation: (check) =>
    `Exactly one ${check.selector} element with text ${JSON.stringify(check.expectedText)}.`,
  evaluate: perSide((check, { evidence }) => {
    const observed = evidence.text.elements.find(
      (element) => element.selector === check.selector,
    );

    if (observed === undefined) {
      return {
        outcome: 'unknown',
        actual: null,
        detail: 'Required check observation unavailable',
      };
    }

    return {
      outcome:
        observed.count === 1 && observed.value === check.expectedText
          ? 'passed'
          : 'failed',
      actual: observed.value,
      detail: `Matched ${observed.count} element(s); text: ${JSON.stringify(observed.value)}.`,
    };
  }),
});
