import {
  describeElement,
  describeFailure,
  describeTotals,
  describeTree,
  elementLabels,
  elementNode,
  elementTrees,
  ruleReference,
  summarizeAccessibility,
  unlisted,
} from '../accessibility-text';
import type { ElementComparison, RuleComparison } from '../accessibility';
import { escapeText } from '../markdown';
import type { MarkdownSection } from './define';

function renderElement(element: ElementComparison, compared: boolean): string {
  const node = elementNode(element);
  const status = compared ? `${elementLabels[element.status]}: ` : '';

  return [
    `- ${status}\`${describeElement(node).replaceAll('`', "'")}\``,
    ...elementTrees(element, compared).map(
      (tree) =>
        `  - ${escapeText(`${tree.label}: ${describeTree(tree.node.tree)}`)}`,
    ),
    `  - ${escapeText(describeFailure(node))}`,
  ].join('\n');
}

function renderRule(rule: RuleComparison, compared: boolean): string {
  const reference = ruleReference(rule);
  const counts = compared
    ? `Elements: ${rule.nodeCount.base} on base, ${rule.nodeCount.candidate} on the candidate.`
    : `Elements: ${rule.nodeCount.candidate}.`;

  return [
    `### ${escapeText(rule.rule)} · ${rule.impact}`,
    [
      escapeText(`${rule.help}.`),
      reference === null ? '' : `[Rule reference](<${reference}>)`,
    ]
      .filter((part) => part !== '')
      .join(' '),
    [counts, unlisted(rule)]
      .filter((part) => part !== null)
      .map((part) => escapeText(part))
      .join(' '),
    rule.elements.map((element) => renderElement(element, compared)).join('\n'),
  ].join('\n\n');
}

export const accessibility: MarkdownSection<'accessibility'> = (input) => {
  const summary = summarizeAccessibility(input);

  if (summary.kind === 'unavailable') {
    return [
      'Accessibility findings unavailable.',
      summary.reasons.map((reason) => `- ${escapeText(reason)}`).join('\n'),
    ].join('\n\n');
  }

  const totals = [
    ...(summary.base === null ? [] : [`Base: ${describeTotals(summary.base)}`]),
    `${summary.compared ? 'Candidate' : 'Capture'}: ${describeTotals(summary.candidate)}`,
  ];
  const incomplete = summary.candidate.incomplete.map(
    (item) =>
      `- ${escapeText(item.rule)}: ${escapeText(item.help)} (${item.nodeCount} element(s))`,
  );

  return [
    escapeText(summary.notice),
    totals.map((line) => `- ${escapeText(line)}`).join('\n'),
    ...summary.rules.map((rule) => renderRule(rule, summary.compared)),
    ...(incomplete.length === 0
      ? []
      : [
          'axe-core could not decide these rules. Review them by hand:',
          incomplete.join('\n'),
        ]),
  ].join('\n\n');
};
