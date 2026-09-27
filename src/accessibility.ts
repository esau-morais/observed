import { Schema } from 'effect';
import { text } from './capture/model';
import type { Evaluation } from './checks/define';

export const impacts = ['minor', 'moderate', 'serious', 'critical'] as const;

export const impactSchema = Schema.Literals(impacts);

export type Impact = typeof impactSchema.Type;

export const defaultImpact: Impact = 'serious';

export const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

// axe identifies an element by one selector per frame; an inner array crosses
// shadow roots inside that frame.
export const targetSchema = Schema.NonEmptyArray(
  Schema.Union([Schema.String, Schema.NonEmptyArray(Schema.String)]),
);

export type Target = typeof targetSchema.Type;

export const treeNodeSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('recorded'),
    role: text,
    name: Schema.String,
    states: Schema.Array(text),
  }),
  Schema.Struct({ kind: Schema.Literal('unavailable'), reason: text }),
]);

export type TreeNode = typeof treeNodeSchema.Type;

const nodeSchema = Schema.Struct({
  target: targetSchema,
  html: Schema.String,
  failureSummary: Schema.String,
  tree: treeNodeSchema,
});

export type FindingNode = typeof nodeSchema.Type;

const ruleIdentity = {
  rule: text,
  help: Schema.String,
  helpUrl: Schema.String,
  nodeCount: count,
};

const listedWithinCount = Schema.makeFilter(
  (finding: { nodeCount: number; nodes: readonly unknown[] }) =>
    finding.nodes.length <= finding.nodeCount,
  { message: 'A finding lists more elements than its node count' },
);

const violationSchema = Schema.Struct({
  ...ruleIdentity,
  impact: impactSchema,
  nodes: Schema.Array(nodeSchema),
}).check(listedWithinCount);

export type Violation = typeof violationSchema.Type;

const incompleteSchema = Schema.Struct({
  ...ruleIdentity,
  impact: Schema.NullOr(impactSchema),
  nodes: Schema.Array(Schema.Struct({ target: targetSchema })),
}).check(listedWithinCount);

export const accessibilitySchema = Schema.Struct({
  engine: Schema.Struct({ name: Schema.Literal('axe-core'), version: text }),
  counts: Schema.Struct({
    violations: count,
    incomplete: count,
    passes: count,
    inapplicable: count,
  }),
  violations: Schema.Array(violationSchema),
  incomplete: Schema.Array(incompleteSchema),
}).check(
  Schema.makeFilter(
    (record) =>
      record.counts.violations === record.violations.length &&
      record.counts.incomplete === record.incomplete.length &&
      new Set(record.violations.map((item) => item.rule)).size ===
        record.violations.length,
    {
      message:
        'Accessibility counts disagree with the recorded rules, or a rule repeats',
    },
  ),
);

export type Accessibility = typeof accessibilitySchema.Type;

export function describeTarget(target: Target): string {
  return target
    .map((part) => (typeof part === 'string' ? part : part.join(' >>> ')))
    .join(' | ');
}

// A scoped snapshot's first line describes the element itself, such as
// `- checkbox "Agree" [checked=true, ref=e4]: value`. Names escape quotes and
// backslashes as JSON strings do.
const treeLine =
  /^- ([^\s"[\]:]+)(?: "((?:[^"\\]|\\.)*)")?(?: \[([^\]]*)\])?(?::.*)?$/u;

export function parseTreeLine(line: string): TreeNode {
  const match = treeLine.exec(line);
  const role = match?.[1];

  if (match === null || role === undefined) {
    return {
      kind: 'unavailable',
      reason: 'The accessibility tree line was not recognized',
    };
  }

  let name = '';

  if (match[2] !== undefined) {
    const decoded = Schema.decodeUnknownOption(
      Schema.fromJsonString(Schema.String),
    )(`"${match[2]}"`);

    if (decoded._tag === 'None') {
      return {
        kind: 'unavailable',
        reason: 'The accessibility tree name was not recognized',
      };
    }

    name = decoded.value;
  }

  const states = (match[3] ?? '')
    .split(', ')
    .filter((state) => state !== '' && !state.startsWith('ref='));

  return { kind: 'recorded', role, name, states };
}

export type ElementComparison =
  | { status: 'persisting'; base: FindingNode; candidate: FindingNode }
  | { status: 'uncertain'; base: FindingNode; candidate: FindingNode }
  | { status: 'new'; candidate: FindingNode }
  | { status: 'maybe-new'; candidate: FindingNode }
  | { status: 'fixed'; base: FindingNode }
  | { status: 'maybe-fixed'; base: FindingNode };

export type ElementStatus = ElementComparison['status'];

export type RuleComparison = {
  rule: string;
  help: string;
  helpUrl: string;
  impact: Impact;
  nodeCount: { base: number; candidate: number };
  elements: ElementComparison[];
};

const complete = (finding: Violation | undefined) =>
  finding === undefined || finding.nodes.length === finding.nodeCount;

// Only the same selector with the same markup confirms the same element. A
// selector can shift when siblings change, and identical markup can belong to
// a fixed element and a new one, so looser matches stay uncertain.
function matchElements(
  previous: Violation | undefined,
  current: Violation | undefined,
): ElementComparison[] {
  const base = previous?.nodes ?? [];
  const candidate = current?.nodes ?? [];
  const keys: readonly ((node: FindingNode) => string)[] = [
    (node) => JSON.stringify([node.target, node.html]),
    (node) => node.html,
    (node) => JSON.stringify(node.target),
  ];
  const matched = new Map<FindingNode, [FindingNode, boolean]>();
  let leftovers = [...base];

  for (const [index, key] of keys.entries()) {
    for (const node of candidate) {
      if (matched.has(node)) {
        continue;
      }

      const position = leftovers.findIndex((item) => key(item) === key(node));
      const other = leftovers[position];

      if (other !== undefined) {
        matched.set(node, [other, index === 0]);
        leftovers = leftovers.filter((_, item) => item !== position);
      }
    }
  }

  return [
    ...candidate.map((node): ElementComparison => {
      const match = matched.get(node);

      if (match === undefined) {
        return complete(previous)
          ? { status: 'new', candidate: node }
          : { status: 'maybe-new', candidate: node };
      }

      return {
        status: match[1] ? 'persisting' : 'uncertain',
        base: match[0],
        candidate: node,
      };
    }),
    ...leftovers.map((node): ElementComparison =>
      complete(current)
        ? { status: 'fixed', base: node }
        : { status: 'maybe-fixed', base: node },
    ),
  ];
}

export function compareAccessibility(
  base: Accessibility | null,
  candidate: Accessibility,
): RuleComparison[] {
  const before = new Map(
    (base?.violations ?? []).map((item) => [item.rule, item]),
  );
  const after = new Map(candidate.violations.map((item) => [item.rule, item]));
  const rules = [...new Set([...after.keys(), ...before.keys()])].sort();

  return rules.flatMap((rule) => {
    const previous = before.get(rule);
    const current = after.get(rule);
    const described = current ?? previous;

    if (described === undefined) {
      return [];
    }

    return [
      {
        rule,
        help: described.help,
        helpUrl: described.helpUrl,
        impact: described.impact,
        nodeCount: {
          base: previous?.nodeCount ?? 0,
          candidate: current?.nodeCount ?? 0,
        },
        elements: matchElements(previous, current),
      },
    ];
  });
}

export function atOrAbove(impact: Impact, threshold: Impact): boolean {
  return impacts.indexOf(impact) >= impacts.indexOf(threshold);
}

function atThreshold(record: Accessibility, threshold: Impact): number {
  return record.violations
    .filter((item) => atOrAbove(item.impact, threshold))
    .reduce((total, item) => total + item.nodeCount, 0);
}

function undecidedRules(record: Accessibility, threshold: Impact): number {
  return record.incomplete.filter(
    (item) => item.impact === null || atOrAbove(item.impact, threshold),
  ).length;
}

function candidateEvaluation(
  base: Accessibility,
  candidate: Accessibility,
  threshold: Impact,
): Evaluation {
  const failing: string[] = [];
  const undecided: string[] = [];
  let newElements = 0;
  const baseRules = new Map(base.violations.map((item) => [item.rule, item]));

  for (const current of candidate.violations) {
    if (!atOrAbove(current.impact, threshold)) {
      continue;
    }

    const previous = baseRules.get(current.rule);
    const elements = matchElements(previous, current);
    const added = Math.max(
      elements.filter((element) => element.status === 'new').length,
      current.nodeCount - (previous?.nodeCount ?? 0),
    );

    if (added > 0) {
      failing.push(`${current.rule} (${current.impact}): ${added}`);
      newElements += added;
    } else if (
      !complete(current) ||
      elements.some(
        (element) =>
          element.status === 'uncertain' || element.status === 'maybe-new',
      )
    ) {
      undecided.push(current.rule);
    }
  }

  if (failing.length > 0) {
    return {
      outcome: 'failed',
      actual: newElements,
      detail: `New ${threshold} or higher violations by rule: ${failing.join('; ')}.`,
    };
  }

  if (undecided.length > 0) {
    return {
      outcome: 'unknown',
      actual: null,
      detail: `Could not confirm that these rules have no new elements: ${undecided.join(', ')}. Only the same selector with the same markup confirms an element, and agent-browser lists at most 10 elements per rule.`,
    };
  }

  const remaining = atThreshold(candidate, threshold);
  const incomplete = undecidedRules(candidate, threshold);

  return {
    outcome: 'passed',
    actual: 0,
    detail: [
      remaining === 0
        ? `No ${threshold} or higher violations on the candidate.`
        : `No new ${threshold} or higher violations. The ${remaining} element(s) at that impact on the candidate also fail on base.`,
      ...(incomplete === 0
        ? []
        : [
            `axe-core could not decide ${incomplete} rule(s) at that impact; review them by hand.`,
          ]),
    ].join(' '),
  };
}

export function evaluateAccessibility({
  threshold,
  base,
  candidate,
}: {
  threshold: Impact;
  base: Accessibility | null;
  candidate: Accessibility;
}): { base: Evaluation | null; candidate: Evaluation } {
  const recorded = (record: Accessibility) =>
    `${atThreshold(record, threshold)} element(s) have ${threshold} or higher violations.`;

  if (base === null) {
    return {
      base: null,
      candidate: {
        outcome: 'not-run',
        actual: null,
        detail: `Finding new violations needs findings from both captures. ${recorded(candidate)}`,
      },
    };
  }

  return {
    base: {
      outcome: 'not-run',
      actual: null,
      detail: `Base sets which violations count as new. ${recorded(base)}`,
    },
    candidate: candidateEvaluation(base, candidate, threshold),
  };
}
