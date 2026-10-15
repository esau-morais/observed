import { Schema } from 'effect';
import { expect, test } from 'vitest';
import {
  accessibilitySchema,
  compareAccessibility,
  evaluateAccessibility,
  parseTreeLine,
  type Accessibility,
  type Impact,
} from '../accessibility';
import { accessibility as accessibilityCheck } from './accessibility';

// The record the legacy collector made from an agent-browser 0.38.1 audit of
// a page with two low-contrast paragraphs, an image without alt text and an
// unlabelled input, with each element's scoped snapshot line.
const audited = {
  engine: { name: 'axe-core', version: '4.12.1' },
  counts: { violations: 3, incomplete: 0, passes: 25, inapplicable: 63 },
  violations: [
    {
      rule: 'color-contrast',
      impact: 'serious',
      help: 'Elements must meet minimum color contrast ratio thresholds',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/color-contrast?application=axeAPI',
      nodeCount: 2,
      nodes: [
        {
          target: ['p:nth-child(3)'],
          html: '<p class="low">Low contrast text one</p>',
          failureSummary:
            'Fix any of the following:\n  Element has insufficient color contrast of 1.91',
          tree: { kind: 'recorded', role: 'paragraph', name: '', states: [] },
        },
        {
          target: ['p:nth-child(4)'],
          html: '<p class="low">Low contrast text two</p>',
          failureSummary:
            'Fix any of the following:\n  Element has insufficient color contrast of 1.91',
          tree: { kind: 'recorded', role: 'paragraph', name: '', states: [] },
        },
      ],
    },
    {
      rule: 'image-alt',
      impact: 'critical',
      help: 'Images must have alternative text',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/image-alt?application=axeAPI',
      nodeCount: 1,
      nodes: [
        {
          target: ['img'],
          html: '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">',
          failureSummary: 'Fix any of the following:\n  Element does not have an alt attribute',
          tree: { kind: 'recorded', role: 'image', name: '', states: [] },
        },
      ],
    },
    {
      rule: 'label',
      impact: 'critical',
      help: 'Form elements must have labels',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/label?application=axeAPI',
      nodeCount: 1,
      nodes: [
        {
          target: ['#nolabel'],
          html: '<input id="nolabel" type="text">',
          failureSummary:
            'Fix any of the following:\n  Element does not have an implicit (wrapped) <label>',
          tree: { kind: 'recorded', role: 'textbox', name: '', states: [] },
        },
      ],
    },
  ],
  incomplete: [],
};

const candidateOutcome = (
  base: Accessibility | null,
  candidate: Accessibility,
  threshold: Impact = 'serious',
) => evaluateAccessibility({ threshold, base, candidate }).candidate;

function recorded(): Accessibility {
  return Schema.decodeUnknownSync(accessibilitySchema)(audited);
}

function without(record: Accessibility, rule: string): Accessibility {
  const violations = record.violations.filter((item) => item.rule !== rule);

  return {
    ...record,
    counts: { ...record.counts, violations: violations.length },
    violations,
  };
}

test('reads names and states from a scoped snapshot line', () => {
  expect(parseTreeLine('- button "Say \\"hi\\" [now]" [ref=e7]')).toEqual({
    kind: 'recorded',
    role: 'button',
    name: 'Say "hi" [now]',
    states: [],
  });
  expect(parseTreeLine('- tab "Tab" [selected, disabled, ref=e11]')).toEqual({
    kind: 'recorded',
    role: 'tab',
    name: 'Tab',
    states: ['selected', 'disabled'],
  });
  expect(parseTreeLine('- combobox [expanded=false, ref=e8]: One')).toEqual({
    kind: 'recorded',
    role: 'combobox',
    name: '',
    states: ['expanded=false'],
  });
  expect(parseTreeLine('not a tree line').kind).toBe('unavailable');
});

test('a removed label fails the check at the default impact', () => {
  const candidate = recorded();
  const base = without(candidate, 'label');
  const verdict = candidateOutcome(base, candidate);
  const label = compareAccessibility(base, candidate).find((item) => item.rule === 'label');

  expect(verdict).toMatchObject({ outcome: 'failed', actual: 1 });
  expect(label?.elements.map((element) => element.status)).toEqual(['new']);
});

test('a new violation below the chosen impact does not fail the check', () => {
  const candidate = recorded();
  const base = without(candidate, 'color-contrast');

  expect(candidateOutcome(base, candidate, 'serious').outcome).toBe('failed');
  expect(candidateOutcome(base, candidate, 'critical').outcome).toBe('passed');
});

test('only the same selector and markup confirm an element, so a moved duplicate stays unknown', () => {
  const base = recorded();
  const moved: Accessibility = {
    ...base,
    violations: base.violations.map((item) =>
      item.rule === 'color-contrast'
        ? {
            ...item,
            nodes: item.nodes.map((node, index) =>
              index === 0 ? { ...node, target: ['p:nth-child(9)'] as const } : node,
            ),
          }
        : item,
    ),
  };
  const contrast = compareAccessibility(base, moved).find((item) => item.rule === 'color-contrast');

  expect(contrast?.elements.map((element) => element.status)).toEqual(['uncertain', 'persisting']);
  expect(candidateOutcome(base, moved).outcome).toBe('unknown');
  expect(candidateOutcome(base, base).outcome).toBe('passed');
});

test('truncated lists leave the check unknown unless the count grew', () => {
  const record = recorded();
  const contrast = record.violations[0];
  const node = contrast?.nodes[0];

  if (contrast === undefined || node === undefined) {
    throw new Error('Fixture has no violations');
  }

  const truncated = (nodeCount: number, target: string): Accessibility => ({
    ...record,
    violations: [
      {
        ...contrast,
        nodeCount,
        nodes: [{ ...node, target: [target] as const, html: target }],
      },
    ],
    counts: { ...record.counts, violations: 1 },
  });

  expect(candidateOutcome(truncated(12, 'p.a'), truncated(12, 'p.b')).outcome).toBe('unknown');
  expect(
    compareAccessibility(truncated(12, 'p.a'), truncated(12, 'p.b'))[0]?.elements.map(
      (element) => element.status,
    ),
  ).toEqual(['maybe-new', 'maybe-fixed']);
  expect(candidateOutcome(truncated(12, 'p.a'), truncated(13, 'p.a'))).toMatchObject({
    outcome: 'failed',
    actual: 1,
  });
});

test('a preview has no baseline, so the check is not run', () => {
  expect(candidateOutcome(null, recorded()).outcome).toBe('not-run');
});

test('findings whose counts disagree with their rules are rejected', () => {
  const record = recorded();

  expect(
    Schema.is(accessibilitySchema)({
      ...record,
      counts: { ...record.counts, violations: 0 },
    }),
  ).toBe(false);
});

test('an unmatched element that resembles one on the other side is only possibly new', () => {
  const record = recorded();
  const contrast = record.violations[0];
  const node = contrast?.nodes[0];

  if (contrast === undefined || node === undefined) {
    throw new Error('Fixture has no violations');
  }

  const side = (elements: [string, string][]): Accessibility => ({
    ...record,
    counts: { ...record.counts, violations: 1 },
    violations: [
      {
        ...contrast,
        nodeCount: elements.length,
        nodes: elements.map(([target, html]) => ({
          ...node,
          target: [target] as const,
          html,
        })),
      },
    ],
  });
  const base = side([
    ['#a', '<button class="x">'],
    ['#b', '<button class="x">'],
  ]);
  const candidate = side([
    ['#c', '<button class="x">'],
    ['#a', '<button class="y">'],
  ]);

  expect(
    compareAccessibility(base, candidate)[0]?.elements.map((element) => element.status),
  ).toEqual(['uncertain', 'maybe-new', 'maybe-fixed']);
  expect(candidateOutcome(base, candidate).outcome).toBe('unknown');
});

test('a rule axe-core could not decide on new elements leaves the check unknown', () => {
  const record = recorded();
  const undecided: Accessibility = {
    ...record,
    counts: { ...record.counts, incomplete: 1 },
    incomplete: [
      {
        rule: 'color-contrast',
        impact: 'serious',
        help: 'Elements must meet minimum color contrast ratio thresholds',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/color-contrast',
        nodeCount: 1,
        nodes: [{ target: ['.hero'] }],
      },
    ],
  };

  expect(candidateOutcome(record, undecided).outcome).toBe('unknown');
  expect(candidateOutcome(undecided, undecided).outcome).toBe('passed');
  expect(candidateOutcome(record, undecided, 'critical').outcome).toBe('passed');
});

test('base is the baseline, so a new violation is reported as a regression', () => {
  const candidate = recorded();
  const side = (value: Accessibility) => ({
    observations: {
      schemaVersion: 3 as const,
      requests: [],
      browserErrors: [],
      window: {
        startedAt: '2026-09-27T00:00:00.000Z',
        finishedAt: '2026-09-27T00:00:01.000Z',
      },
    },
    evidence: { accessibility: value },
  });
  const definition = {
    kind: 'accessibility' as const,
    id: 'no-new-a11y-violations',
    name: 'No new accessibility violations',
    scope: 'Final page state',
  };
  const base = side(without(candidate, 'label'));
  const after = side(candidate);
  const evaluated = accessibilityCheck.evaluate({
    definition,
    base,
    candidate: after,
    comparable: true,
  });

  expect(evaluated.base?.outcome).toBe('passed');
  expect(evaluated.candidate.outcome).toBe('failed');
  expect(
    accessibilityCheck.regression?.({
      definition,
      base: { ...base, evaluation: evaluated.base ?? evaluated.candidate },
      candidate: { ...after, evaluation: evaluated.candidate },
    }),
  ).toEqual({ detail: evaluated.candidate.detail });
});
