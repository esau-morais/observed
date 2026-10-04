import * as stylex from '@stylexjs/stylex';
import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactEvidence } from '../../evidence-kinds/react';
import { fonts, geometry, media } from '../constants.stylex';
import { EvidenceLink } from '../evidence';
import { SubHeading } from '../heading';
import {
  changedNode,
  oneSided,
  renderTree,
  treeRows,
  type NodeState,
  type RenderTree as Tree,
  type TreeNode,
  type TreeRow,
} from '../react-tree';
import { colors } from '../tokens.stylex';
import type { SectionSide, ViewerSection } from './define';

const styles = stylex.create({
  stack: { display: 'grid', gap: 12, minWidth: 0 },
  sides: {
    display: 'grid',
    gap: 24,
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      [media.tablet]: 'repeat(2, minmax(0, 1fr))',
    },
  },
  heading: { fontSize: '1.25rem', fontWeight: 500, lineHeight: 1.35 },
  subheading: { fontWeight: 500 },
  text: { color: colors.textSecondary, maxWidth: '68ch' },
  caption: { color: colors.textMuted, fontSize: '0.8125rem' },
  mono: {
    fontFamily: fonts.mono,
    fontSize: '0.8125rem',
    overflowWrap: 'anywhere',
  },
  missing: {
    padding: 24,
    backgroundColor: colors.unknownFill,
    color: colors.unknown,
    borderRadius: geometry.radius,
  },
  scroll: {
    overflowX: 'auto',
    borderColor: colors.border,
    borderStyle: 'solid',
    borderWidth: 1,
    borderRadius: geometry.radius,
    outlineColor: {
      default: colors.focus,
      [media.forcedColors]: 'Highlight',
    },
    outlineOffset: 3,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
  },
  table: { borderCollapse: 'collapse', width: '100%', textAlign: 'start' },
  cell: {
    borderBottomColor: colors.border,
    borderBottomStyle: 'solid',
    borderBottomWidth: 1,
    padding: 12,
    verticalAlign: 'top',
    textAlign: 'start',
  },
  number: { textAlign: 'end', fontVariantNumeric: 'tabular-nums' },
  column: {
    backgroundColor: colors.surfaceMuted,
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },
  tree: { display: 'grid', gap: 4, margin: 0, padding: 0, listStyle: 'none' },
  depth: (depth: number) => ({ paddingInlineStart: `${depth * 16}px` }),
  controls: {
    alignItems: 'center',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
  },
  button: {
    alignItems: 'center',
    backgroundColor: {
      default: colors.surface,
      [media.hover]: { default: colors.surface, ':hover': colors.surfaceMuted },
    },
    borderColor: colors.borderControl,
    borderRadius: 8,
    borderStyle: 'solid',
    borderWidth: 1,
    color: colors.text,
    cursor: 'pointer',
    display: 'inline-flex',
    fontFamily: fonts.sans,
    fontSize: '0.875rem',
    fontWeight: 500,
    minHeight: geometry.target,
    paddingInline: 12,
    outlineColor: { default: colors.focus, [media.forcedColors]: 'Highlight' },
    outlineOffset: 2,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
  },
  summary: {
    cursor: 'pointer',
    fontWeight: 500,
    minHeight: geometry.target,
    paddingBlock: 10,
    outlineColor: { default: colors.focus, [media.forcedColors]: 'Highlight' },
    outlineOffset: 3,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
  },
  treeLayout: {
    alignItems: 'start',
    display: 'grid',
    gap: 16,
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      [media.desktop]: 'minmax(0, 1fr) 16rem',
    },
  },
  treeBox: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: geometry.radius,
    borderStyle: 'solid',
    borderWidth: 1,
    fontFamily: fonts.mono,
    fontSize: '0.8125rem',
    minWidth: 0,
    overflowX: 'auto',
    paddingBlock: 8,
  },
  row: {
    alignItems: 'center',
    columnGap: 8,
    display: 'grid',
    gridTemplateColumns: {
      default: '2ch minmax(max-content, 1fr)',
      [media.tablet]: '2ch minmax(max-content, 1fr) minmax(max-content, 1fr)',
    },
    minHeight: 28,
    paddingInline: 12,
  },
  oneColumn: { gridTemplateColumns: '2ch minmax(max-content, 1fr)' },
  header: {
    color: colors.textMuted,
    fontFamily: fonts.sans,
    fontWeight: 500,
    minHeight: 32,
  },
  treeRow: {
    cursor: 'pointer',
    transitionDuration: { default: '120ms', [media.reduceMotion]: '0ms' },
    transitionProperty: 'color',
    backgroundColor: {
      default: 'transparent',
      [media.hover]: { default: 'transparent', ':hover': colors.surfaceMuted },
    },
    outlineColor: { default: colors.focus, [media.forcedColors]: 'Highlight' },
    outlineOffset: -2,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
  },
  dimmed: { color: colors.textMuted },
  scoped: { backgroundColor: colors.surfaceMuted },
  selectedRow: { backgroundColor: colors.surfaceMuted },
  gutter: { color: colors.changed, fontWeight: 500, textAlign: 'center' },
  gutterUnknown: { color: colors.unknown },
  wideOnly: { display: { default: 'none', [media.tablet]: 'block' } },
  narrowOnly: { display: { default: 'block', [media.tablet]: 'none' } },
  treeCell: { display: 'block', whiteSpace: 'pre' },
  folded: { color: colors.textMuted },
  absent: { color: colors.textMuted },
  onlyHere: {
    backgroundColor: colors.changedFill,
    borderRadius: 4,
    color: colors.changed,
    marginInlineStart: -4,
    paddingInline: 4,
  },
  markStroke: { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 },
  changedName: { color: colors.changed, fontWeight: 500 },
  count: { color: colors.textMuted, fontVariantNumeric: 'tabular-nums' },
  changedCount: { color: colors.changed },
  detail: {
    borderColor: colors.border,
    borderRadius: geometry.radius,
    borderStyle: 'solid',
    borderWidth: 1,
    display: 'grid',
    gap: 8,
    margin: 0,
    padding: 16,
  },
  detailName: { fontFamily: fonts.mono, fontWeight: 500 },
  detailRows: { display: 'grid', gap: 8, margin: 0 },
  detailRow: { display: 'grid', gap: 2 },
  detailTerm: { color: colors.textMuted, fontSize: '0.8125rem' },
});

export type ComponentSource = {
  readonly words: string;
  readonly place: string;
  readonly href: string | null;
};

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function countText(value: number | null): string {
  return value === null ? '?' : String(value);
}

const markers = {
  rendered: '●',
  ancestor: '○',
  absent: '·',
  unrecorded: '?',
} satisfies Record<NodeState, string>;

const stateWords = {
  rendered: 'rendered during steps',
  ancestor: 'did not render, kept as an ancestor',
  absent: 'not in the recorded tree',
  unrecorded: 'unknown: the recorded tree reached its limit',
} satisfies Record<NodeState, string>;

const gutterWords = {
  '+': 'in the After tree only',
  '−': 'in the Before tree only',
  '?': 'count unknown on one side',
  Δ: 'render count changed',
  '': '',
} as const;

// Shapes, not glyphs, so the mark carries no text of its own; the row's
// accessible name states the change.
function GutterMark({ mark }: { mark: keyof typeof gutterWords }) {
  if (mark === '') {
    return null;
  }

  return (
    <svg viewBox="0 0 10 10" width={10} height={10} aria-hidden="true">
      <title>{gutterWords[mark]}</title>
      {mark === 'Δ' ? (
        <path d="M5 1 L9 9 L1 9 Z" {...stylex.props(styles.markStroke)} />
      ) : null}
      {mark === '+' || mark === '−' ? (
        <path d="M1 5 H9" {...stylex.props(styles.markStroke)} />
      ) : null}
      {mark === '+' ? (
        <path d="M5 1 V9" {...stylex.props(styles.markStroke)} />
      ) : null}
      {mark === '?' ? (
        <circle cx={5} cy={5} r={3.5} {...stylex.props(styles.markStroke)} />
      ) : null}
    </svg>
  );
}

function gutter(node: TreeNode): keyof typeof gutterWords {
  const side = oneSided(node.state);

  if (side !== null) {
    return side === 'candidate' ? '+' : '−';
  }

  if (node.change === 'unknown') {
    return '?';
  }

  return node.change === 'same' ? '' : 'Δ';
}

function describeNode(node: TreeNode, comparing: boolean): string {
  const { base, candidate } = node.renders;

  if (!comparing) {
    const state = node.state.candidate ?? node.state.base ?? 'absent';

    return `${node.name}, ${countText(candidate ?? base)} renders, ${stateWords[state]}`;
  }

  const side = oneSided(node.state);
  const presence =
    side === null
      ? ''
      : `, in the ${side === 'candidate' ? 'After' : 'Before'} tree only`;

  const unrecorded = (['base', 'candidate'] as const)
    .filter((key) => node.state[key] === 'unrecorded')
    .map(
      (key) =>
        `, ${key === 'base' ? 'Before' : 'After'} tree past its recording limit`,
    )
    .join('');

  return `${node.name}, renders before ${countText(base)}, after ${countText(candidate)}${presence}${unrecorded}`;
}

function counts(value: ReactEvidence | null, name: string) {
  return value?.components.find((item) => item.name === name) ?? null;
}

function describeCounts(value: ReactEvidence, name: string): string {
  const entry = counts(value, name);

  if (entry !== null) {
    return `${plural(entry.mounts + entry.updates, 'render')}: ${plural(entry.mounts, 'mount')}, ${plural(entry.updates, 'update')}`;
  }

  return value.truncated.components
    ? 'renders unknown: recording limit reached'
    : '0 renders';
}

function NodeDetail({
  node,
  base,
  candidate,
  candidateLabel,
  source,
}: {
  node: TreeNode;
  base: ReactEvidence | null;
  candidate: ReactEvidence | null;
  candidateLabel: string;
  source: ComponentSource | undefined;
}) {
  const sides = [
    ...(base === null
      ? []
      : [{ label: 'Before', value: base, state: node.state.base }]),
    ...(candidate === null
      ? []
      : [
          {
            label: candidateLabel,
            value: candidate,
            state: node.state.candidate,
          },
        ]),
  ];
  const script = [candidate, base]
    .flatMap((value) => value?.sources ?? [])
    .find((item) => item.component === node.name);

  return (
    <section
      aria-label={`${node.name} details`}
      {...stylex.props(styles.detail)}
    >
      <p {...stylex.props(styles.detailName)}>{node.name}</p>
      <dl {...stylex.props(styles.detailRows)}>
        {sides.map(({ label, value, state }) => {
          return (
            <div key={label} {...stylex.props(styles.detailRow)}>
              <dt {...stylex.props(styles.detailTerm)}>{label}</dt>
              <dd {...stylex.props(styles.mono)}>
                {describeCounts(value, node.name)}
                {state === null ? '' : ` · ${stateWords[state]}`}
              </dd>
            </div>
          );
        })}
        {source === undefined && script !== undefined ? (
          <div {...stylex.props(styles.detailRow)}>
            <dt {...stylex.props(styles.detailTerm)}>Script position</dt>
            <dd>
              <span {...stylex.props(styles.mono)}>
                {script.script}:{script.line}:{script.column}
              </span>{' '}
              (not source-mapped)
            </dd>
          </div>
        ) : null}
        {source === undefined ? null : (
          <div {...stylex.props(styles.detailRow)}>
            <dt {...stylex.props(styles.detailTerm)}>Source</dt>
            <dd>
              {source.words}{' '}
              {source.href === null ? (
                <span {...stylex.props(styles.mono)}>{source.place}</span>
              ) : (
                <EvidenceLink href={source.href}>
                  <span {...stylex.props(styles.mono)}>{source.place}</span>
                </EvidenceLink>
              )}
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}

function treeSummary(tree: Tree): string {
  if (!tree.comparing) {
    return 'Renders per component during steps.';
  }

  const changed = tree.changedNames;

  return changed === 0
    ? 'Each component rendered the same number of times before and after.'
    : `${plural(changed, 'component')} rendered a different number of times or on one side only.`;
}

function TreeCell({
  row,
  side,
  merged,
  dimmed,
}: {
  row: TreeRow;
  side: 'base' | 'candidate';
  merged: boolean;
  dimmed: boolean;
}) {
  const prefix = `${row.guides}${row.connector}`;

  if (row.kind === 'fold') {
    return (
      <span {...stylex.props(styles.treeCell, styles.folded)}>
        {`${prefix}⋯ ${plural(row.size, 'component')} unchanged`}
      </span>
    );
  }

  const { node } = row;
  const state = node.state[side] ?? 'absent';
  const value = node.renders[side];
  const other = node.renders[side === 'base' ? 'candidate' : 'base'];
  const changed = changedNode(node) && !dimmed;
  const present = state === 'rendered' || state === 'ancestor';

  return (
    <span
      {...stylex.props(
        styles.treeCell,
        !present && styles.absent,
        !merged && !dimmed && oneSided(node.state) === side && styles.onlyHere,
      )}
    >
      <span {...stylex.props(changed && styles.changedName)}>
        {`${prefix}${markers[state]} ${node.name}`}
      </span>
      <span {...stylex.props(styles.count, changed && styles.changedCount)}>
        {merged
          ? ` (${countText(node.renders.base)} → ${countText(node.renders.candidate)})`
          : ''}
        {!merged && present ? ` (${countText(value)})` : ''}
        {!merged &&
        side === 'candidate' &&
        value !== null &&
        other !== null &&
        value !== other
          ? ` ${value > other ? '+' : '−'}${Math.abs(value - other)}`
          : ''}
      </span>
    </span>
  );
}

// Before and After parent trees side by side, one row per merged node, in
// the layout of Mega_Jules's parent and owner trees
// (https://x.com/Mega_Jules/status/2096205050800398455). Hover dims everything
// outside the node's subtree and ancestors; keyboard focus tints that scope
// instead, so focused text keeps its contrast.
export function RenderTree({
  base,
  candidate,
  baseUnavailable,
  sources,
}: {
  base: ReactEvidence | null;
  candidate: ReactEvidence | null;
  // Why a requested comparison has no Before recording, when it has none.
  baseUnavailable: string | null;
  sources: ReadonlyMap<string, ComponentSource>;
}) {
  const tree = renderTree(base, candidate);
  const [all, setAll] = useState(false);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const refocus = useRef<number | null>(null);
  const rows = treeRows(tree, all, opened);
  const columns = tree.comparing ? 'two' : 'one';
  const candidateLabel =
    baseUnavailable === null && !tree.comparing ? 'Capture' : 'After';
  const inScopeOf = (scopeIndex: number | null) => {
    const scope = scopeIndex === null ? undefined : rows[scopeIndex];

    return (index: number) =>
      scope === undefined ||
      scopeIndex === null ||
      (index >= scopeIndex && index <= scope.end) ||
      scope.ancestors.includes(index);
  };

  const hoverScope = inScopeOf(hovered);
  const focusScope = inScopeOf(focused && hovered === null ? active : null);

  // Opening a fold replaces the focused row with its first component.
  useLayoutEffect(() => {
    const index = refocus.current;

    refocus.current = null;

    if (index !== null) {
      rowRefs.current[index]?.focus();
    }
  }, [opened]);
  const selectedNode = rows.find(
    (row) => row.kind === 'node' && row.key === selected,
  );

  const move = (index: number) => {
    const next = Math.max(0, Math.min(rows.length - 1, index));

    setActive(next);
    rowRefs.current[next]?.focus();
  };

  const activate = (index: number) => {
    const row = rows[index];

    if (row?.kind === 'fold') {
      refocus.current = index;
      setOpened((current) => new Set([...current, row.key]));
    } else if (row !== undefined) {
      setSelected((current) => (current === row.key ? null : row.key));
    }
  };

  if (tree.roots.length === 0 && tree.outside.length === 0) {
    return (
      <p {...stylex.props(styles.text)}>
        No component rendered during steps on{' '}
        {tree.comparing ? 'either side' : 'this capture'}.
      </p>
    );
  }

  return (
    <div {...stylex.props(styles.stack)}>
      <div {...stylex.props(styles.controls)}>
        <p {...stylex.props(styles.text)}>{treeSummary(tree)}</p>
        {tree.comparing && tree.roots.length > 0 ? (
          <button
            type="button"
            aria-pressed={all}
            onClick={() => setAll((value) => !value)}
            {...stylex.props(styles.button)}
          >
            {all ? 'Fold unchanged' : 'Show all components'}
          </button>
        ) : null}
      </div>
      {baseUnavailable === null ? null : (
        <p {...stylex.props(styles.missing)}>
          Before React evidence unavailable: {baseUnavailable} The tree shows
          After only.
        </p>
      )}
      <p {...stylex.props(styles.caption)}>
        ● rendered during steps · ○ ancestor that did not render · ? past the
        recording limit · (count) renders per component name · Δ, + and − mark a
        changed count or a node in one tree only. Props, hooks, owners and state
        flow are not recorded, so no data-flow edges are drawn. Arrow keys move,
        Enter shows details or opens a fold.
      </p>
      {tree.roots.length === 0 ? null : (
        <div {...stylex.props(styles.treeLayout)}>
          <div {...stylex.props(styles.treeBox)}>
            {tree.comparing ? (
              <div
                aria-hidden="true"
                {...stylex.props(styles.row, styles.header)}
              >
                <span />
                <span {...stylex.props(styles.wideOnly)}>Before</span>
                <span {...stylex.props(styles.wideOnly)}>After</span>
                <span {...stylex.props(styles.narrowOnly)}>Before → After</span>
              </div>
            ) : null}
            <div
              role="tree"
              aria-label={
                tree.comparing
                  ? 'Component tree, before and after'
                  : 'Component tree'
              }
              onFocus={() => setFocused(true)}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  setFocused(false);
                }
              }}
              onMouseLeave={() => setHovered(null)}
            >
              {rows.map((row, index) => {
                return (
                  <div
                    key={row.key}
                    ref={(element) => {
                      rowRefs.current[index] = element;
                    }}
                    role="treeitem"
                    aria-level={row.depth + 1}
                    aria-selected={row.kind === 'node' && row.key === selected}
                    aria-expanded={
                      row.kind === 'node' && row.node.children.length > 0
                        ? true
                        : undefined
                    }
                    aria-label={
                      row.kind === 'fold'
                        ? `${plural(row.size, 'component')} unchanged, folded. Enter shows them.`
                        : describeNode(row.node, tree.comparing)
                    }
                    tabIndex={
                      index === Math.min(active, rows.length - 1) ? 0 : -1
                    }
                    onMouseEnter={() => setHovered(index)}
                    onFocus={() => setActive(index)}
                    onClick={() => {
                      setActive(index);
                      activate(index);
                    }}
                    onKeyDown={(event) => {
                      const keys: Record<string, () => void> = {
                        ArrowDown: () => move(index + 1),
                        ArrowUp: () => move(index - 1),
                        Home: () => move(0),
                        End: () => move(rows.length - 1),
                        Enter: () => activate(index),
                        ' ': () => activate(index),
                        ArrowRight: () => {
                          if (row.kind === 'fold') {
                            activate(index);
                          } else if (row.end > index) {
                            move(index + 1);
                          }
                        },
                        ArrowLeft: () => {
                          const parent = row.ancestors.at(-1);

                          if (parent !== undefined) {
                            move(parent);
                          }
                        },
                      };
                      const action = keys[event.key];

                      if (action !== undefined) {
                        event.preventDefault();
                        action();
                      }
                    }}
                    {...stylex.props(
                      styles.row,
                      styles.treeRow,
                      columns === 'one' && styles.oneColumn,
                      !hoverScope(index) && styles.dimmed,
                      hovered === null &&
                        focused &&
                        focusScope(index) &&
                        styles.scoped,
                      row.kind === 'node' &&
                        row.key === selected &&
                        styles.selectedRow,
                    )}
                  >
                    <span
                      aria-hidden="true"
                      {...stylex.props(
                        styles.gutter,
                        row.kind === 'node' &&
                          row.node.change === 'unknown' &&
                          oneSided(row.node.state) === null &&
                          styles.gutterUnknown,
                        !hoverScope(index) && styles.dimmed,
                      )}
                    >
                      {row.kind === 'node' && tree.comparing ? (
                        <GutterMark mark={gutter(row.node)} />
                      ) : null}
                    </span>
                    {tree.comparing ? (
                      <>
                        <span {...stylex.props(styles.wideOnly)}>
                          <TreeCell
                            row={row}
                            side="base"
                            merged={false}
                            dimmed={!hoverScope(index)}
                          />
                        </span>
                        <span {...stylex.props(styles.wideOnly)}>
                          <TreeCell
                            row={row}
                            side="candidate"
                            merged={false}
                            dimmed={!hoverScope(index)}
                          />
                        </span>
                        <span {...stylex.props(styles.narrowOnly)}>
                          <TreeCell
                            row={row}
                            side="candidate"
                            merged
                            dimmed={!hoverScope(index)}
                          />
                        </span>
                      </>
                    ) : (
                      <TreeCell
                        row={row}
                        side={candidate === null ? 'base' : 'candidate'}
                        merged={false}
                        dimmed={!hoverScope(index)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          {selectedNode?.kind === 'node' ? (
            <NodeDetail
              node={selectedNode.node}
              base={base}
              candidate={candidate}
              candidateLabel={candidateLabel}
              source={sources.get(selectedNode.node.name)}
            />
          ) : (
            <p {...stylex.props(styles.detail, styles.caption)}>
              Select a component for its mounts, updates and source location.
            </p>
          )}
        </div>
      )}
      {tree.outside.length === 0 ? null : (
        <div {...stylex.props(styles.stack)}>
          <p {...stylex.props(styles.subheading)}>
            Changed outside the recorded tree
          </p>
          <ul {...stylex.props(styles.tree)}>
            {tree.outside.map((change) => (
              <li key={change.name} {...stylex.props(styles.mono)}>
                {change.name} ({change.base} → {change.candidate})
              </li>
            ))}
          </ul>
        </div>
      )}
      <p {...stylex.props(styles.caption)}>
        Counts are per component name: instances that share a name show the same
        total. The tree holds components that rendered during steps and their
        ancestors, not host elements.
      </p>
    </div>
  );
}

function Table({
  label,
  columns,
  rows,
}: {
  label: string;
  columns: readonly string[];
  rows: readonly (readonly [string, ...(string | number)[]])[];
}) {
  return (
    <div
      {...stylex.props(styles.scroll)}
      role="region"
      aria-label={`${label}, scroll horizontally for all columns`}
      tabIndex={0}
    >
      <table {...stylex.props(styles.table)}>
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th
                key={column}
                scope="col"
                {...stylex.props(
                  styles.cell,
                  styles.column,
                  index > 0 && styles.number,
                )}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, ...values]) => (
            <tr key={name}>
              <th scope="row" {...stylex.props(styles.cell, styles.mono)}>
                {name}
              </th>
              {values.map((value, index) => (
                <td
                  key={index}
                  {...stylex.props(styles.cell, styles.mono, styles.number)}
                >
                  {value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Recording({ value, label }: { value: ReactEvidence; label: string }) {
  const renderers = value.renderers
    .map(
      (renderer) =>
        `React ${renderer.version ?? 'version unknown'}, ${renderer.build} build`,
    )
    .join('; ');
  const limits = [
    value.truncated.components && 'rendered components',
    value.truncated.mounted && 'mounted component names',
    value.truncated.subtree && 'the rendered subtree',
  ].filter((item) => item !== false);

  return (
    <div {...stylex.props(styles.stack)}>
      <p {...stylex.props(styles.text)}>
        {value.commits} commit(s) during steps. {renderers}.
      </p>
      {limits.length > 0 ? (
        <p {...stylex.props(styles.missing)}>
          Recording limit reached for {limits.join(', ')}; components beyond it
          are not listed.
        </p>
      ) : null}
      {value.components.length === 0 ? (
        <p {...stylex.props(styles.text)}>
          No component rendered during steps.
        </p>
      ) : (
        <Table
          label={`${label} renders by component`}
          columns={['Component', 'Renders', 'Mounts', 'Updates']}
          rows={value.components.map((item) => [
            item.name,
            item.mounts + item.updates,
            item.mounts,
            item.updates,
          ])}
        />
      )}
      {value.subtree.length > 0 ? (
        <div {...stylex.props(styles.stack)}>
          <p {...stylex.props(styles.subheading)}>Rendered subtree</p>
          <ul
            {...stylex.props(styles.tree)}
            aria-label={`${label} rendered subtree`}
          >
            {value.subtree.map((node, index) => (
              <li
                key={index}
                {...stylex.props(styles.mono, styles.depth(node.depth))}
              >
                {node.name}
                {node.rendered ? ' (rendered)' : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {value.sources.length > 0 ? (
        <div {...stylex.props(styles.stack)}>
          <p {...stylex.props(styles.subheading)}>Script positions</p>
          <p {...stylex.props(styles.caption)}>
            Where React DevTools located each component in the script the
            browser loaded. Positions are not source-mapped.
          </p>
          <ul {...stylex.props(styles.tree)}>
            {value.sources.map((source) => (
              <li key={source.component} {...stylex.props(styles.mono)}>
                {source.component}: {source.script}:{source.line}:
                {source.column}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Side({
  side: { evidence: view },
  label,
}: {
  side: SectionSide<'react'>;
  label: string;
}) {
  return (
    <section
      {...stylex.props(styles.stack)}
      aria-label={`${label} React renders`}
    >
      <SubHeading xstyle={styles.heading}>{label}</SubHeading>
      {view.status === 'recorded' ? (
        <Recording value={view.value} label={label} />
      ) : (
        <p {...stylex.props(styles.missing)}>
          React evidence unavailable: {view.reason}
        </p>
      )}
    </section>
  );
}

export const ReactSection: ViewerSection<'react'> = ({ base, candidate }) => {
  return (
    <div {...stylex.props(styles.stack)}>
      <p {...stylex.props(styles.caption)}>
        Counted in a separate browser run with React DevTools enabled. A render
        counts when React commits work for the component during the
        journey&apos;s steps, as React DevTools highlights it; a render React
        discards after bailing out does not. Components that share a name are
        summed. These counts are not timing measurements.
      </p>
      <details>
        <summary {...stylex.props(styles.summary)}>
          Counts by component, subtree and script positions
        </summary>
        <div {...stylex.props(styles.sides)}>
          {base === null ? null : <Side side={base} label="Before" />}
          <Side
            side={candidate}
            label={base === null ? 'Current capture' : 'After'}
          />
        </div>
      </details>
    </div>
  );
};
