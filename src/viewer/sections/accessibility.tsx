import * as stylex from '@stylexjs/stylex';
import type { ElementComparison, RuleComparison } from '../../accessibility';
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
} from '../../accessibility-text';
import { fonts, geometry, media } from '../constants.stylex';
import { toneSymbols } from '../../result-text';
import { SubHeading } from '../heading';
import { colors } from '../tokens.stylex';
import type { ViewerSection } from './define';

const styles = stylex.create({
  stack: { display: 'grid', gap: 16, minWidth: 0 },
  rule: {
    display: 'grid',
    gap: 12,
    minWidth: 0,
    borderTopColor: colors.border,
    borderTopStyle: 'solid',
    borderTopWidth: 1,
    paddingTop: 16,
  },
  heading: { fontSize: '1.125rem', fontWeight: 500, lineHeight: 1.35 },
  text: { color: colors.textSecondary, maxWidth: '68ch' },
  caption: { color: colors.textMuted, fontSize: '0.8125rem', maxWidth: '80ch' },
  mono: {
    fontFamily: fonts.mono,
    fontSize: '0.8125rem',
    overflowWrap: 'anywhere',
  },
  list: { display: 'grid', gap: 16, paddingInlineStart: 20, marginBlock: 0 },
  element: { display: 'grid', gap: 6, minWidth: 0 },
  status: { fontWeight: 500, marginInlineEnd: 8 },
  new: { color: colors.changed },
  definition: {
    display: 'grid',
    gap: 4,
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      [media.tablet]: 'max-content minmax(0, 1fr)',
    },
    columnGap: 12,
    margin: 0,
  },
  row: { display: 'contents' },
  term: { color: colors.textMuted },
  detail: { margin: 0 },
  missing: {
    padding: 24,
    backgroundColor: colors.unknownFill,
    color: colors.unknown,
    borderRadius: geometry.radius,
  },
  link: {
    color: colors.text,
    textDecoration: 'underline',
    textUnderlineOffset: 3,
    outlineColor: {
      default: colors.focus,
      [media.forcedColors]: 'Highlight',
    },
    outlineOffset: 3,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
  },
});

function Element({
  element,
  compared,
}: {
  element: ElementComparison;
  compared: boolean;
}) {
  const node = elementNode(element);
  const trees = elementTrees(element, compared);

  return (
    <li {...stylex.props(styles.element)}>
      <p>
        {compared ? (
          <span
            {...stylex.props(
              styles.status,
              element.status === 'new' && styles.new,
            )}
          >
            {element.status === 'new' ? (
              <span aria-hidden="true">Δ </span>
            ) : null}
            {elementLabels[element.status]}
          </span>
        ) : null}{' '}
        <code {...stylex.props(styles.mono)}>{describeElement(node)}</code>
      </p>
      <dl {...stylex.props(styles.definition)}>
        {trees.map((tree) => (
          <div key={tree.label} {...stylex.props(styles.row)}>
            <dt {...stylex.props(styles.term)}>{tree.label}</dt>
            <dd {...stylex.props(styles.detail)}>
              {describeTree(tree.node.tree)}
            </dd>
          </div>
        ))}
      </dl>
      <p {...stylex.props(styles.caption)}>{describeFailure(node)}</p>
    </li>
  );
}

function Rule({ rule, compared }: { rule: RuleComparison; compared: boolean }) {
  const reference = ruleReference(rule);
  const note = unlisted(rule);

  return (
    <section
      {...stylex.props(styles.rule)}
      aria-label={`Accessibility rule ${rule.rule}`}
    >
      <SubHeading xstyle={styles.heading}>
        <span {...stylex.props(styles.mono)}>{rule.rule}</span> · {rule.impact}
      </SubHeading>
      <p {...stylex.props(styles.text)}>
        {rule.help}.
        {reference === null ? null : (
          <>
            {' '}
            <a href={reference} {...stylex.props(styles.link)}>
              Rule reference
            </a>
          </>
        )}
      </p>
      <p {...stylex.props(styles.caption)}>
        {compared
          ? `Elements: ${rule.nodeCount.base} on base, ${rule.nodeCount.candidate} on the candidate.`
          : `Elements: ${rule.nodeCount.candidate}.`}
        {note === null ? null : ` ${note}`}
      </p>
      <ul {...stylex.props(styles.list)}>
        {rule.elements.map((element, index) => (
          <Element key={index} element={element} compared={compared} />
        ))}
      </ul>
    </section>
  );
}

export const AccessibilitySection: ViewerSection<'accessibility'> = (input) => {
  const summary = summarizeAccessibility(input);

  if (summary.kind === 'unavailable') {
    return (
      <div {...stylex.props(styles.missing)}>
        <p>
          <span aria-hidden="true">{toneSymbols.unknown} </span>
          Accessibility findings unavailable.
        </p>
        <ul>
          {summary.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div {...stylex.props(styles.stack)}>
      <p {...stylex.props(styles.text)}>{summary.notice}</p>
      <ul {...stylex.props(styles.list)}>
        {summary.base === null ? null : (
          <li>Base: {describeTotals(summary.base)}</li>
        )}
        <li>
          {summary.compared ? 'Candidate' : 'Capture'}:{' '}
          {describeTotals(summary.candidate)}
        </li>
      </ul>
      {summary.rules.map((rule) => (
        <Rule key={rule.rule} rule={rule} compared={summary.compared} />
      ))}
      {summary.candidate.incomplete.length === 0 ? null : (
        <section {...stylex.props(styles.rule)}>
          <SubHeading xstyle={styles.heading}>Needs manual review</SubHeading>
          <p {...stylex.props(styles.text)}>
            axe-core could not decide these rules automatically.
          </p>
          <ul {...stylex.props(styles.list)}>
            {summary.candidate.incomplete.map((item) => (
              <li key={item.rule}>
                <span {...stylex.props(styles.mono)}>{item.rule}</span>:{' '}
                {item.help} ({item.nodeCount} element(s))
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};
