import type {
  Accessibility,
  ElementComparison,
  ElementStatus,
  FindingNode,
  RuleComparison,
  TreeNode,
} from './accessibility';
import { compareAccessibility, describeTarget } from './accessibility';
import type { SectionInput } from './report-sections/define';

export type AccessibilityInput = SectionInput<'accessibility'>;

export function accessibilityNotice(record: Accessibility): string {
  return `Automated axe-core ${record.engine.version} findings for the page after the journey. Automated rules catch only some accessibility problems, so these findings don't establish that the page is accessible.`;
}

export const elementLabels = {
  persisting: 'Still present',
  uncertain: 'Possibly the same element',
  new: 'New',
  'maybe-new': 'Possibly new, base list truncated',
  fixed: 'Fixed',
  'maybe-fixed': 'Possibly fixed, candidate list truncated',
} satisfies Record<ElementStatus, string>;

export function describeTree(node: TreeNode): string {
  if (node.kind === 'unavailable') {
    return `Not recorded. ${node.reason}.`;
  }

  const name =
    node.name === ''
      ? 'no accessible name'
      : `name ${JSON.stringify(node.name)}`;

  return [node.role, name, ...node.states].join(', ');
}

// axe-core writes a heading line such as "Fix any of the following:" and
// then one indented reason per line.
export function describeFailure(node: FindingNode): string {
  const [heading = '', ...reasons] = node.failureSummary
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

  return reasons.length === 0
    ? heading
    : `${heading} ${reasons.map((reason) => reason.replace(/\.$/, '')).join('; ')}.`;
}

export function describeElement(node: FindingNode): string {
  return describeTarget(node.target);
}

export function describeTotals(record: Accessibility): string {
  const elements = record.violations.reduce(
    (total, item) => total + item.nodeCount,
    0,
  );

  return record.violations.length === 0
    ? 'No violated rules.'
    : `${record.violations.length} violated rule(s) on ${elements} element(s).`;
}

// Rule references come from axe-core's metadata; only HTTPS links are shown.
export function ruleReference(rule: RuleComparison): string | null {
  const url = URL.parse(rule.helpUrl);

  return url?.protocol === 'https:' ? url.href : null;
}

export function unlisted(rule: RuleComparison): string | null {
  const base = rule.elements.filter((element) => 'base' in element).length;
  const candidate = rule.elements.filter(
    (element) => 'candidate' in element,
  ).length;
  const missing = [
    rule.nodeCount.base - base,
    rule.nodeCount.candidate - candidate,
  ];

  if (missing.every((count) => count === 0)) {
    return null;
  }

  return `agent-browser lists at most 10 elements per rule. Unlisted: ${missing[0]} on base, ${missing[1]} on the candidate.`;
}

export function elementNode(element: ElementComparison): FindingNode {
  return 'candidate' in element ? element.candidate : element.base;
}

export function elementTrees(
  element: ElementComparison,
  compared: boolean,
): { label: string; node: FindingNode }[] {
  switch (element.status) {
    case 'new':
    case 'maybe-new':
      return [
        {
          label: compared ? 'Candidate tree' : 'Tree',
          node: element.candidate,
        },
      ];
    case 'fixed':
    case 'maybe-fixed':
      return [{ label: 'Base tree', node: element.base }];
    case 'persisting':
    case 'uncertain':
      return compared
        ? [
            { label: 'Base tree', node: element.base },
            { label: 'Candidate tree', node: element.candidate },
          ]
        : [{ label: 'Tree', node: element.candidate }];
  }
}

export type AccessibilitySummary =
  | { kind: 'unavailable'; reasons: string[] }
  | {
      kind: 'recorded';
      notice: string;
      compared: boolean;
      base: Accessibility | null;
      candidate: Accessibility;
      rules: RuleComparison[];
    };

export function summarizeAccessibility({
  base,
  candidate,
  comparable,
}: AccessibilityInput): AccessibilitySummary {
  const before = base?.evidence ?? null;
  const after = candidate.evidence;
  const reasons = [
    ...(before?.status === 'unavailable' ? [`Base: ${before.reason}`] : []),
    ...(after.status === 'unavailable' ? [`Candidate: ${after.reason}`] : []),
  ];

  if (after.status === 'unavailable') {
    return { kind: 'unavailable', reasons };
  }

  const baseline = before?.status === 'recorded' ? before.value : null;
  const compared = baseline !== null && comparable;

  return {
    kind: 'recorded',
    notice: [
      accessibilityNotice(after.value),
      ...reasons,
      ...(baseline !== null && !comparable
        ? [
            "The captures aren't comparable, so elements are not labelled new or fixed.",
          ]
        : []),
    ].join(' '),
    compared,
    base: baseline,
    candidate: after.value,
    rules: compareAccessibility(compared ? baseline : null, after.value),
  };
}
