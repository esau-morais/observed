import { Effect, Predicate, Schema } from 'effect';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'vitest';
import {
  accessibilitySchema,
  compareAccessibility,
  evaluateAccessibility,
  parseTreeLine,
  type Accessibility,
  type Impact,
} from '../src/accessibility';
import {
  auditSchema,
  recordAccessibility,
} from '../src/capture/collectors/accessibility';
import { escapeText } from '../src/markdown';
import { accessibility as renderAccessibility } from '../src/report-sections/accessibility';

const fixture = path.join(import.meta.dirname, 'fixtures/accessibility');

// Scoped snapshot lines recorded from page.html; see fixtures/accessibility.
const snapshots: Record<string, string> = {
  'p:nth-child(3)': '- paragraph\n  - StaticText "Low contrast text one"',
  'p:nth-child(4)': '- paragraph\n  - StaticText "Low contrast text two"',
  img: '- image',
  '#nolabel': '- textbox [ref=e15]',
};

const candidateOutcome = (
  base: Accessibility | null,
  candidate: Accessibility,
  threshold: Impact = 'serious',
) => evaluateAccessibility({ threshold, base, candidate }).candidate;

const snapshot = (selector: string) => {
  const line = snapshots[selector];

  return line === undefined
    ? Effect.fail('Selector did not match any element')
    : Effect.succeed(
        JSON.stringify({ success: true, data: { snapshot: line } }),
      );
};

async function recorded(): Promise<Accessibility> {
  const output = await readFile(path.join(fixture, 'a11y.json'), 'utf8');
  const result = await Effect.runPromise(
    recordAccessibility(Effect.succeed(output), snapshot),
  );

  return Schema.decodeUnknownSync(accessibilitySchema)(result);
}

function without(record: Accessibility, rule: string): Accessibility {
  const violations = record.violations.filter((item) => item.rule !== rule);

  return {
    ...record,
    counts: { ...record.counts, violations: violations.length },
    violations,
  };
}

test('records axe violations with the failing element from the accessibility tree', async () => {
  const record = await recorded();
  const label = record.violations.find((item) => item.rule === 'label');

  expect(record.engine.version).toBe('4.12.1');
  expect(record.violations.map((item) => item.rule)).toEqual([
    'color-contrast',
    'image-alt',
    'label',
  ]);
  expect(label?.impact).toBe('critical');
  expect(label?.nodes[0]?.tree).toEqual({
    kind: 'recorded',
    role: 'textbox',
    name: '',
    states: [],
  });
});

test('an audit the producer could not run is unavailable, not empty', async () => {
  const failed = await Effect.runPromise(
    Effect.flip(recordAccessibility(Effect.fail('exit 1'), snapshot)),
  );
  const unrecognized = await Effect.runPromise(
    Effect.flip(
      recordAccessibility(
        Effect.succeed('{"success":true,"data":{}}'),
        snapshot,
      ),
    ),
  );

  expect(Predicate.isTagged(failed, 'EvidenceUnavailable')).toBe(true);
  expect(Predicate.isTagged(unrecognized, 'EvidenceUnavailable')).toBe(true);
});

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

test('a removed label fails the check at the default impact', async () => {
  const candidate = await recorded();
  const base = without(candidate, 'label');
  const verdict = candidateOutcome(base, candidate);
  const label = compareAccessibility(base, candidate).find(
    (item) => item.rule === 'label',
  );

  expect(verdict).toMatchObject({ outcome: 'failed', actual: 1 });
  expect(label?.elements.map((element) => element.status)).toEqual(['new']);
});

test('a new violation below the chosen impact does not fail the check', async () => {
  const candidate = await recorded();
  const base = without(candidate, 'color-contrast');

  expect(candidateOutcome(base, candidate, 'serious').outcome).toBe('failed');
  expect(candidateOutcome(base, candidate, 'critical').outcome).toBe('passed');
});

test('only the same selector and markup confirm an element, so a moved duplicate stays unknown', async () => {
  const base = await recorded();
  const moved: Accessibility = {
    ...base,
    violations: base.violations.map((item) =>
      item.rule === 'color-contrast'
        ? {
            ...item,
            nodes: item.nodes.map((node, index) =>
              index === 0
                ? { ...node, target: ['p:nth-child(9)'] as const }
                : node,
            ),
          }
        : item,
    ),
  };
  const contrast = compareAccessibility(base, moved).find(
    (item) => item.rule === 'color-contrast',
  );

  expect(contrast?.elements.map((element) => element.status)).toEqual([
    'uncertain',
    'persisting',
  ]);
  expect(candidateOutcome(base, moved).outcome).toBe('unknown');
  expect(candidateOutcome(base, base).outcome).toBe('passed');
});

test('page selectors never reach agent-browser as options, and generic elements are not looked up', async () => {
  const output = Schema.decodeUnknownSync(Schema.fromJsonString(auditSchema))(
    await readFile(path.join(fixture, 'a11y.json'), 'utf8'),
  );
  const violations = output.data.violations.map((item) => ({
    ...item,
    nodes: item.nodes.map((node) => {
      if (node.target[0] === '#nolabel') {
        return { ...node, target: ['-x'] as const };
      }

      return node.target[0] === 'p:nth-child(3)'
        ? { ...node, html: '<span class="low">Low contrast text one</span>' }
        : node;
    }),
  }));
  const looked: string[] = [];
  const result = await Effect.runPromise(
    recordAccessibility(
      Effect.succeed(
        JSON.stringify({ ...output, data: { ...output.data, violations } }),
      ),
      (selector) => {
        looked.push(selector);

        return snapshot(selector);
      },
    ),
  );

  expect(looked).toEqual(['p:nth-child(4)', 'img']);
  expect(result.violations[0]?.nodes[0]?.tree.kind).toBe('unavailable');
  expect(result.violations[2]?.nodes[0]?.tree.kind).toBe('unavailable');
});

test('truncated lists leave the check unknown unless the count grew', async () => {
  const record = await recorded();
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

  expect(
    candidateOutcome(truncated(12, 'p.a'), truncated(12, 'p.b')).outcome,
  ).toBe('unknown');
  expect(
    compareAccessibility(
      truncated(12, 'p.a'),
      truncated(12, 'p.b'),
    )[0]?.elements.map((element) => element.status),
  ).toEqual(['maybe-new', 'maybe-fixed']);
  expect(
    candidateOutcome(truncated(12, 'p.a'), truncated(13, 'p.a')),
  ).toMatchObject({ outcome: 'failed', actual: 1 });
});

test('a preview has no baseline, so the check is not run', async () => {
  const record = await recorded();

  expect(candidateOutcome(null, record).outcome).toBe('not-run');
});

test('findings whose counts disagree with their rules are rejected', async () => {
  const record = await recorded();

  expect(
    Schema.is(accessibilitySchema)({
      ...record,
      counts: { ...record.counts, violations: 0 },
    }),
  ).toBe(false);
});

test('without a usable base, findings are listed but not called new', async () => {
  const record = await recorded();
  const side = (value: Accessibility) => ({
    evidence: { kind: 'accessibility', status: 'recorded', value } as const,
    artifacts: [],
  });
  const compared = renderAccessibility({
    base: side(without(record, 'label')),
    candidate: side(record),
  });
  const uncompared = renderAccessibility({
    base: {
      evidence: {
        kind: 'accessibility',
        status: 'unavailable',
        reason: 'agent-browser a11y failed',
      },
      artifacts: [],
    },
    candidate: side(record),
  });

  expect(compared).toContain('- New: `#nolabel`');
  expect(uncompared).not.toContain('New:');
  expect(uncompared).toContain(escapeText('Base: agent-browser a11y failed'));
  expect(uncompared).toContain("don't establish that the page is accessible");
});
