import * as stylex from '@stylexjs/stylex';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { recipeLines, scopeLine } from '../change-scope-text';
import type {
  Comparison,
  MapBlock,
  MapConnection,
  MapEvidence,
} from '../comparison-model';
import {
  anchorLocation,
  toneSymbols,
  verdictLabels,
  verdictTones,
  type Tone,
} from '../result-text';
import { fonts, geometry, media, motion } from './constants.stylex';
import { EvidenceLink } from './evidence';
import { curve, layoutGraph, type Box, type Point } from './map-layout';
import {
  connectionKinds,
  connectionLabels,
  connectionSources,
  connectionText,
  scopeTable,
  verdictChecks,
  type RecordedMap,
  type RecordedScope,
} from './map-model';
import {
  cardKinds,
  cardPath,
  cardSentence,
  children,
  hasParts,
  indexMap,
  levelTrail,
  openLevel,
  parentLevel,
  partsLabel,
  repoPath,
  type Card,
  type Level,
  type Link,
  type MapIndex,
  type Status,
} from './map-view';
import { colors } from './tokens.stylex';

const styles = stylex.create({
  section: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: geometry.radius,
    borderStyle: 'solid',
    borderWidth: 1,
    display: 'grid',
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      [media.desktop]: 'minmax(0, 1fr) 22rem',
    },
    minWidth: 0,
    overflow: 'clip',
  },
  main: { display: 'grid', alignContent: 'start', minWidth: 0 },
  header: {
    borderBottomColor: colors.border,
    borderBottomStyle: 'solid',
    borderBottomWidth: 1,
    display: 'grid',
    gap: 8,
    paddingBlock: 16,
    paddingInline: { default: 16, [media.desktop]: 24 },
  },
  titleRow: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8 },
  title: {
    fontSize: '1.375rem',
    fontWeight: 600,
    letterSpacing: '-0.02em',
    lineHeight: 1.2,
  },
  trail: {
    alignItems: 'center',
    color: colors.textMuted,
    display: 'flex',
    flexWrap: 'wrap',
    fontFamily: fonts.mono,
    fontSize: '0.75rem',
    gap: 4,
    listStyle: 'none',
    margin: 0,
    padding: 0,
  },
  lead: { color: colors.text, maxWidth: '72ch' },
  counts: { color: colors.textMuted, fontSize: '0.8125rem' },
  legendRow: {
    alignItems: 'center',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    listStyle: 'none',
    margin: 0,
    padding: 0,
  },
  legendLabel: {
    color: colors.textSecondary,
    fontSize: '0.75rem',
    fontWeight: 600,
    marginInlineEnd: 4,
  },
  pill: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 9999,
    borderStyle: 'solid',
    borderWidth: 1,
    color: colors.text,
    display: 'inline-flex',
    fontSize: '0.75rem',
    gap: 6,
    paddingBlock: 2,
    paddingInline: 8,
    whiteSpace: 'nowrap',
  },
  pillEmpty: { color: colors.textMuted, opacity: 0.6 },
  pillCount: {
    color: colors.textMuted,
    fontVariantNumeric: 'tabular-nums',
  },
  hint: { color: colors.textMuted, fontSize: '0.75rem' },
  toggle: {
    backgroundColor: {
      default: 'transparent',
      [media.hover]: { default: 'transparent', ':hover': colors.surfaceMuted },
    },
    borderColor: colors.borderControl,
    borderRadius: 8,
    borderStyle: 'solid',
    borderWidth: 1,
    color: colors.text,
    cursor: 'pointer',
    fontFamily: fonts.sans,
    fontSize: '0.8125rem',
    fontWeight: 500,
    minHeight: 32,
    outlineColor: {
      default: 'transparent',
      ':focus-visible': colors.focus,
      [media.forcedColors]: 'Highlight',
    },
    outlineOffset: 2,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
    paddingInline: 12,
  },
  pressed: {
    backgroundColor: colors.action,
    borderColor: colors.action,
    color: colors.onAction,
  },
  scroller: {
    minHeight: 240,
    overflowX: 'auto',
    overscrollBehaviorX: 'contain',
    paddingBlock: 24,
    paddingInline: { default: 12, [media.desktop]: 24 },
    touchAction: 'manipulation',
  },
  canvas: { marginInline: 'auto', position: 'relative' },
  size: (width: number, height: number) => ({
    height: `${height}px`,
    width: `${width}px`,
  }),
  place: (box: Box) => ({
    height: `${box.height}px`,
    left: `${box.x}px`,
    top: `${box.y}px`,
    width: `${box.width}px`,
  }),
  edges: {
    insetBlockStart: 0,
    insetInlineStart: 0,
    overflow: 'visible',
    pointerEvents: 'none',
    position: 'absolute',
  },
  container: {
    borderColor: colors.borderControl,
    borderRadius: 12,
    borderStyle: 'dashed',
    borderWidth: 1,
    boxSizing: 'border-box',
    position: 'absolute',
  },
  rowLabel: {
    color: colors.textSecondary,
    fontSize: '0.75rem',
    fontWeight: 600,
    position: 'absolute',
    whiteSpace: 'nowrap',
  },
  rowNote: { color: colors.textMuted, fontWeight: 400 },
  rule: {
    borderTopColor: colors.border,
    borderTopStyle: 'dashed',
    borderTopWidth: 1,
    position: 'absolute',
  },
  card: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.borderControl,
    borderRadius: 8,
    borderStyle: 'solid',
    borderWidth: 1,
    boxSizing: 'border-box',
    color: colors.text,
    cursor: 'pointer',
    display: 'grid',
    fontFamily: fonts.sans,
    gridTemplateRows: 'auto auto 1fr',
    minWidth: 0,
    outlineColor: {
      default: 'transparent',
      ':focus-visible': colors.focus,
      [media.forcedColors]: 'Highlight',
    },
    outlineOffset: 2,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
    paddingBlock: 8,
    paddingInline: 10,
    position: 'absolute',
    textAlign: 'start',
    transitionDuration: { default: motion.fast, [media.reduceMotion]: '0ms' },
    transitionProperty: 'opacity, border-color',
  },
  cardChanged: { borderColor: colors.text },
  cardQuiet: { backgroundColor: colors.surface, color: colors.textSecondary },
  cardOutside: { backgroundColor: colors.surface, borderStyle: 'dashed' },
  cardJourney: { borderColor: colors.linkCheckedBy },
  cardRemoved: { borderStyle: 'dashed', borderColor: colors.unknown },
  cardSelected: {
    borderColor: { default: colors.focus, [media.forcedColors]: 'Highlight' },
    boxShadow: `0 0 0 1px ${colors.focus}`,
  },
  dim: { opacity: 0.25 },
  cardTop: {
    alignItems: 'center',
    display: 'flex',
    gap: 6,
    justifyContent: 'space-between',
    minWidth: 0,
  },
  eyebrow: {
    color: colors.textMuted,
    fontFamily: fonts.mono,
    fontSize: '0.625rem',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  },
  cardName: {
    display: '-webkit-box',
    fontSize: '0.875rem',
    fontWeight: 600,
    lineHeight: 1.3,
    overflow: 'hidden',
    overflowWrap: 'anywhere',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
  },
  cardFoot: {
    alignItems: 'end',
    color: colors.textMuted,
    display: 'flex',
    fontSize: '0.6875rem',
    gap: 4,
    justifyContent: 'space-between',
    minWidth: 0,
  },
  cardFootText: {
    fontFamily: fonts.mono,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  chevron: { color: colors.focus, fontSize: '0.75rem' },
  chip: {
    alignItems: 'center',
    borderRadius: 4,
    display: 'inline-flex',
    fontSize: '0.6875rem',
    fontWeight: 600,
    gap: 3,
    lineHeight: 1.4,
    paddingInline: 5,
    whiteSpace: 'nowrap',
  },
  kindChip: {
    borderColor: colors.borderControl,
    borderStyle: 'solid',
    borderWidth: 1,
    color: colors.textSecondary,
    fontFamily: fonts.mono,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  neutral: {
    backgroundColor: colors.surfaceMuted,
    color: colors.textSecondary,
  },
  checked: { backgroundColor: colors.checkedFill, color: colors.checked },
  regression: {
    backgroundColor: colors.regressionFill,
    color: colors.regression,
  },
  unknown: { backgroundColor: colors.unknownFill, color: colors.unknown },
  line: { fill: 'none', strokeWidth: 1.75 },
  hit: {
    fill: 'none',
    pointerEvents: 'stroke',
    stroke: 'transparent',
    strokeWidth: 12,
  },
  faint: { opacity: 0.18 },
  rest: { opacity: 0.45 },
  strong: { strokeWidth: 2.25 },
  edgeGroup: {
    transitionDuration: { default: motion.fast, [media.reduceMotion]: '0ms' },
    transitionProperty: 'opacity',
  },
  badge: {
    fill: colors.surfaceRaised,
    stroke: colors.borderControl,
    strokeWidth: 1,
  },
  badgeText: {
    fill: colors.text,
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: 600,
  },
  removed: { strokeDasharray: '1 5', strokeLinecap: 'round' },
  imports: { color: colors.linkImports, stroke: colors.linkImports },
  'ran-in': {
    color: colors.linkRanIn,
    stroke: colors.linkRanIn,
    strokeDasharray: '7 4',
  },
  requested: {
    color: colors.linkRequested,
    stroke: colors.linkRequested,
    strokeDasharray: '2 4',
  },
  'threw-at': {
    color: colors.linkThrewAt,
    stroke: colors.linkThrewAt,
    strokeDasharray: '9 3 2 3',
  },
  'checked-by': {
    color: colors.linkCheckedBy,
    stroke: colors.linkCheckedBy,
    strokeDasharray: '14 4',
  },
  sample: { flexShrink: 0, height: 10, width: 24 },
  tooltip: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.borderControl,
    borderRadius: 8,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: '0 4px 12px rgba(8,17,18,0.18)',
    display: 'grid',
    fontSize: '0.75rem',
    gap: 4,
    maxWidth: 320,
    paddingBlock: 8,
    paddingInline: 10,
    pointerEvents: 'none',
    position: 'absolute',
    zIndex: 2,
  },
  tooltipPlace: (x: number, y: number) => ({
    left: `${x}px`,
    top: `${y}px`,
  }),
  tooltipTitle: { fontWeight: 600 },
  panel: {
    alignContent: 'start',
    backgroundColor: colors.canvas,
    borderInlineStartColor: colors.border,
    borderInlineStartStyle: { default: 'none', [media.desktop]: 'solid' },
    borderInlineStartWidth: 1,
    borderTopColor: colors.border,
    borderTopStyle: { default: 'solid', [media.desktop]: 'none' },
    borderTopWidth: 1,
    display: 'grid',
    gap: 16,
    maxHeight: { default: 'none', [media.desktop]: '100vh' },
    minWidth: 0,
    outlineColor: {
      default: 'transparent',
      ':focus-visible': colors.focus,
      [media.forcedColors]: 'Highlight',
    },
    outlineOffset: -2,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
    overflowY: 'auto',
    padding: { default: 16, [media.desktop]: 20 },
    position: { default: 'static', [media.desktop]: 'sticky' },
    top: 0,
  },
  panelName: { fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.3 },
  mono: {
    fontFamily: fonts.mono,
    fontSize: '0.75rem',
    overflowWrap: 'anywhere',
  },
  muted: { color: colors.textMuted },
  text: { color: colors.textSecondary, fontSize: '0.875rem', lineHeight: 1.5 },
  panelHeading: {
    color: colors.textMuted,
    fontFamily: fonts.mono,
    fontSize: '0.6875rem',
    fontWeight: 500,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  group: { display: 'grid', gap: 6 },
  list: { display: 'grid', gap: 2, listStyle: 'none', margin: 0, padding: 0 },
  partRow: {
    alignItems: 'center',
    backgroundColor: {
      default: 'transparent',
      [media.hover]: { default: 'transparent', ':hover': colors.surfaceMuted },
    },
    borderRadius: 6,
    borderWidth: 0,
    color: colors.text,
    cursor: 'pointer',
    display: 'flex',
    fontFamily: fonts.sans,
    fontSize: '0.875rem',
    gap: 8,
    justifyContent: 'space-between',
    minHeight: 32,
    outlineColor: {
      default: 'transparent',
      ':focus-visible': colors.focus,
      [media.forcedColors]: 'Highlight',
    },
    outlineOffset: -2,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
    paddingInline: 6,
    textAlign: 'start',
    width: '100%',
  },
  connection: {
    borderTopColor: colors.border,
    borderTopStyle: 'solid',
    borderTopWidth: 1,
    display: 'grid',
    gap: 2,
    paddingBlock: 6,
  },
  connectionHead: {
    alignItems: 'center',
    display: 'flex',
    flexWrap: 'wrap',
    fontSize: '0.8125rem',
    gap: 6,
  },
  kindWord: { fontSize: '0.75rem', fontWeight: 600 },
  linkButton: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    color: colors.focus,
    cursor: 'pointer',
    fontFamily: fonts.sans,
    fontSize: '0.8125rem',
    fontWeight: 600,
    minHeight: 24,
    outlineColor: {
      default: 'transparent',
      ':focus-visible': colors.focus,
      [media.forcedColors]: 'Highlight',
    },
    outlineOffset: 2,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
    padding: 0,
    textAlign: 'start',
    textDecoration: {
      default: 'none',
      [media.hover]: { default: 'none', ':hover': 'underline' },
    },
  },
  reason: { color: colors.textSecondary, fontSize: '0.8125rem' },
  summary: {
    cursor: 'pointer',
    outlineColor: {
      default: 'transparent',
      ':focus-visible': colors.focus,
      [media.forcedColors]: 'Highlight',
    },
    outlineOffset: 2,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
  },
  evidence: {
    display: 'grid',
    gap: 2,
    paddingBlockStart: 4,
    paddingInlineStart: 14,
  },
  tableWrap: { maxWidth: '100%', overflowX: 'auto', padding: 16 },
  table: {
    borderCollapse: 'collapse',
    fontSize: '0.875rem',
    minWidth: '36rem',
    width: '100%',
  },
  caption: { color: colors.textMuted, paddingBottom: 8, textAlign: 'start' },
  cell: {
    borderBottomColor: colors.border,
    borderBottomStyle: 'solid',
    borderBottomWidth: 1,
    paddingBlock: 8,
    paddingInlineEnd: 12,
    textAlign: 'start',
    verticalAlign: 'top',
  },
  headCell: { color: colors.textMuted, fontWeight: 500 },
  quiet: {
    display: 'grid',
    gap: 8,
  },
  heading: {
    fontSize: '1.5rem',
    fontWeight: 500,
    letterSpacing: '-0.02em',
    lineHeight: 1.2,
  },
  srOnly: {
    blockSize: 1,
    clipPath: 'inset(50%)',
    inlineSize: 1,
    overflow: 'hidden',
    position: 'absolute',
    whiteSpace: 'nowrap',
  },
});

type Selection = { kind: 'card'; id: string } | null;

function StatusChip({
  status,
  compact = false,
}: {
  status: Status;
  compact?: boolean;
}) {
  return (
    <span {...stylex.props(styles.chip, styles[status.tone])}>
      {status.symbol === '' ? null : (
        <span aria-hidden="true">{status.symbol}</span>
      )}
      {compact ? (status.short ?? status.label) : status.label}
    </span>
  );
}

function ToneChip({ tone, label }: { tone: Tone; label: string }) {
  return <StatusChip status={{ tone, label, symbol: toneSymbols[tone] }} />;
}

function LineSample({
  kind,
  removed = false,
}: {
  kind: MapConnection['kind'];
  removed?: boolean;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 10"
      {...stylex.props(styles.sample)}
    >
      <line
        x1="0"
        y1="5"
        x2="18"
        y2="5"
        {...stylex.props(styles.line, styles[kind], removed && styles.removed)}
      />
      <path
        d="M 17 1.5 L 23 5 L 17 8.5 z"
        fill="currentColor"
        {...stylex.props(styles[kind])}
      />
    </svg>
  );
}

function Evidence({ evidence }: { evidence: readonly MapEvidence[] }) {
  return (
    <ul {...stylex.props(styles.list, styles.evidence)}>
      {evidence.map((item) => (
        <li
          key={
            item.kind === 'artifact' ? item.path : `${item.journey} ${item.id}`
          }
          {...stylex.props(styles.mono)}
        >
          {item.kind === 'artifact' ? (
            <EvidenceLink href={`./${item.path}`}>{item.path}</EvidenceLink>
          ) : (
            `Finding ${item.id} in ${item.journey}`
          )}
        </li>
      ))}
    </ul>
  );
}

const sizes = {
  wide: { width: 184, height: 84 },
  narrow: { width: 150, height: 84 },
};

type Placed = {
  width: number;
  height: number;
  cards: Map<string, Box>;
  edges: Map<string, Point[]>;
  container: Box | null;
  outsideLabel: Point | null;
  journeyRule: { y: number; width: number } | null;
};

function linkKey(link: Pick<Link, 'from' | 'to'>) {
  return `${link.from}\u0000${link.to}`;
}

// Inside cards in layered rows, the outside row under them, and the journey
// row last. Only the first two take part in the layered layout; journey
// links show on demand, as feature links do in the reference.
function placeLevel(level: Level, width: number, root: boolean): Placed {
  const size = width < 560 ? sizes.narrow : sizes.wide;
  const pad = root ? 0 : 16;
  const top = root ? 0 : 36;
  const inner = Math.max(size.width, width - pad * 2);
  const layout = layoutGraph(
    [
      ...level.inside.map((card) => ({ id: card.id, ...size, bottom: false })),
      ...level.outside.map((card) => ({ id: card.id, ...size, bottom: true })),
    ],
    [...new Map(level.links.map((link) => [linkKey(link), link])).values()].map(
      (link) => ({ id: linkKey(link), from: link.from, to: link.to }),
    ),
    { maxWidth: inner, nodeGap: 24, rankGap: 56, bottomGap: 96 },
  );
  const insideHeight =
    layout.bottomTop === null ? layout.height : layout.bottomTop - 96;
  const contentWidth = Math.max(layout.width + pad * 2, Math.min(width, 640));
  const shift = (contentWidth - layout.width) / 2;
  const cards = new Map<string, Box>();

  for (const [id, box] of layout.nodes) {
    cards.set(id, { ...box, x: box.x + shift, y: box.y + top });
  }

  const edges = new Map<string, Point[]>();

  for (const [id, points] of layout.edges) {
    edges.set(
      id,
      points.map((point) => ({ x: point.x + shift, y: point.y + top })),
    );
  }

  const container = root
    ? null
    : { x: 0, y: 0, width: contentWidth, height: insideHeight + top + pad };
  let y = layout.height + top + (layout.bottomTop === null ? pad + 40 : 40);
  const outsideLabel =
    layout.bottomTop === null
      ? null
      : { x: shift, y: layout.bottomTop + top - 24 };
  let journeyRule: Placed['journeyRule'] = null;

  if (level.journeys.length > 0) {
    journeyRule = { y, width: contentWidth };
    y += 36;
    const perRow = Math.max(
      1,
      Math.floor((contentWidth + 16) / (size.width + 16)),
    );

    level.journeys.forEach((card, index) => {
      const row = Math.floor(index / perRow);
      const column = index % perRow;
      const count = Math.min(perRow, level.journeys.length - row * perRow);
      const rowWidth = count * size.width + (count - 1) * 16;

      cards.set(card.id, {
        x: (contentWidth - rowWidth) / 2 + column * (size.width + 16),
        y: y + row * (size.height + 16),
        ...size,
      });
    });
    y += Math.ceil(level.journeys.length / perRow) * (size.height + 16) - 16;
  }

  return {
    width: contentWidth,
    height: y,
    cards,
    edges,
    container,
    outsideLabel,
    journeyRule,
  };
}

function journeyPath(from: Box, to: Box): string {
  const start =
    from.y > to.y
      ? { x: from.x + from.width / 2, y: from.y }
      : { x: from.x + from.width / 2, y: from.y + from.height };
  const end =
    from.y > to.y
      ? { x: to.x + to.width / 2, y: to.y + to.height }
      : { x: to.x + to.width / 2, y: to.y };

  if (Math.abs(start.y - end.y) < 4) {
    const dip = Math.max(start.y, end.y) + 36;

    return `M ${start.x} ${from.y + from.height} C ${start.x} ${dip}, ${end.x} ${dip}, ${end.x} ${to.y + to.height}`;
  }

  return curve([start, end]);
}

function cardLabel(index: MapIndex, card: Card, links: number): string {
  const path = cardPath(index, card);

  return [
    `${cardKinds[card.kind]} ${card.name}`,
    path,
    card.status.label,
    partsLabel(card),
    `${links} ${links === 1 ? 'connection' : 'connections'}`,
    hasParts(card) ? 'opens on Enter' : null,
  ]
    .filter((part) => part !== null)
    .join(', ');
}

function eyebrowOf(card: Card, place: 'inside' | 'outside' | 'journey') {
  if (card.kind === 'package') {
    return 'packages';
  }

  if (card.kind === 'outside-files') {
    return 'files';
  }

  return place === 'outside'
    ? `outside · ${cardKinds[card.kind]}`
    : cardKinds[card.kind];
}

function CardButton({
  index,
  card,
  box,
  place,
  links,
  dimmed,
  selected,
  onActive,
  onOpen,
}: {
  index: MapIndex;
  card: Card;
  box: Box;
  place: 'inside' | 'outside' | 'journey';
  links: number;
  dimmed: boolean;
  selected: boolean;
  onActive: (id: string | null) => void;
  onOpen: (card: Card) => void;
}) {
  const changed =
    (card.kind === 'file' && card.file !== undefined) ||
    (card.kind === 'directory' && card.changed.length > 0);
  const foot = partsLabel(card);

  return (
    <button
      type="button"
      data-card={card.id}
      aria-label={cardLabel(index, card, links)}
      aria-pressed={selected}
      onClick={() => onOpen(card)}
      onPointerEnter={() => onActive(card.id)}
      onPointerLeave={() => onActive(null)}
      onFocus={() => onActive(card.id)}
      onBlur={() => onActive(null)}
      {...stylex.props(
        styles.card,
        styles.place(box),
        changed && styles.cardChanged,
        !changed && place === 'inside' && styles.cardQuiet,
        place === 'outside' && styles.cardOutside,
        card.kind === 'journey' && styles.cardJourney,
        card.kind === 'removed-journey' && styles.cardRemoved,
        selected && styles.cardSelected,
        dimmed && styles.dim,
      )}
    >
      <span {...stylex.props(styles.cardTop)}>
        <span {...stylex.props(styles.eyebrow)}>
          {eyebrowOf(card, place)}
        </span>
        <StatusChip status={card.status} compact />
      </span>
      <span {...stylex.props(styles.cardName)}>{card.name}</span>
      <span {...stylex.props(styles.cardFoot)}>
        <span {...stylex.props(styles.cardFootText)}>{foot}</span>
        {hasParts(card) ? (
          <span aria-hidden="true" {...stylex.props(styles.chevron)}>
            ›
          </span>
        ) : null}
      </span>
    </button>
  );
}

function linkTitle(link: Link, names: ReadonlyMap<string, string>) {
  return `${names.get(link.from) ?? link.from} → ${names.get(link.to) ?? link.to}`;
}

function Tooltip({
  links,
  names,
  blocks,
  at,
}: {
  links: readonly Link[];
  names: ReadonlyMap<string, string>;
  blocks: ReadonlyMap<string, MapBlock>;
  at: Point;
}) {
  const [first] = links;

  if (first === undefined) {
    return null;
  }

  const connections = links.flatMap((link) =>
    link.connections.map((connection) => ({ link, connection })),
  );
  const counts = connectionKinds
    .map(
      (kind) =>
        [
          kind,
          connections.filter((item) => item.connection.kind === kind).length,
        ] as const,
    )
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${count} ${connectionLabels[kind].toLowerCase()}`);

  return (
    <div
      role="tooltip"
      {...stylex.props(styles.tooltip, styles.tooltipPlace(at.x, at.y))}
    >
      <span {...stylex.props(styles.tooltipTitle)}>
        {linkTitle(first, names)}
      </span>
      <span {...stylex.props(styles.muted)}>
        {connections.length}{' '}
        {connections.length === 1 ? 'connection' : 'connections'}:{' '}
        {counts.join(', ')}
      </span>
      {connections.slice(0, 8).map(({ link, connection }, position) => (
        <span key={position} {...stylex.props(styles.connectionHead)}>
          <LineSample kind={connection.kind} removed={link.removed} />
          <span>{connectionText(connection, blocks)}</span>
        </span>
      ))}
      {connections.length > 8 ? (
        <span {...stylex.props(styles.muted)}>
          {connections.length - 8} more in the panel
        </span>
      ) : null}
    </div>
  );
}

function MapCanvas({
  index,
  level,
  root,
  selection,
  focusId,
  onOpen,
}: {
  index: MapIndex;
  level: Level;
  root: boolean;
  selection: Selection;
  focusId: string | null;
  onOpen: (card: Card) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  const [active, setActive] = useState<string | null>(null);
  const [hovered, setHovered] = useState<{ key: string; at: Point } | null>(
    null,
  );

  useLayoutEffect(() => {
    const element = scroller.current;

    if (element === null) {
      return;
    }

    const measure = () => {
      const style = getComputedStyle(element);
      const inner =
        element.clientWidth -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight);

      // Snap to 40 px so small resizes keep the same layout.
      setWidth(Math.max(300, Math.floor(inner / 40) * 40));
    };
    const observer = new ResizeObserver(measure);

    measure();
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (focusId === null) {
      return;
    }

    scroller.current
      ?.querySelector<HTMLElement>(`[data-card="${CSS.escape(focusId)}"]`)
      ?.focus();
  }, [focusId, level]);

  const placed = useMemo(
    () => placeLevel(level, width, root),
    [level, width, root],
  );
  const cards = useMemo(
    () =>
      [
        ...level.inside.map((card) => ({ card, place: 'inside' as const })),
        ...level.outside.map((card) => ({ card, place: 'outside' as const })),
        ...level.journeys.map((card) => ({ card, place: 'journey' as const })),
      ].flatMap((item) => {
        const box = placed.cards.get(item.card.id);

        return box === undefined ? [] : [{ ...item, box }];
      }),
    [level, placed],
  );
  // Reading order: rows top to bottom, then left to right.
  const ordered = useMemo(
    () =>
      [...cards].sort((left, right) =>
        Math.abs(left.box.y - right.box.y) < 8
          ? left.box.x - right.box.x
          : left.box.y - right.box.y,
      ),
    [cards],
  );
  const names = useMemo(
    () => new Map(cards.map(({ card }) => [card.id, card.name])),
    [cards],
  );
  const allLinks = useMemo(
    () => [...level.links, ...level.journeyLinks],
    [level],
  );
  const linkCount = useMemo(() => {
    const counts = new Map<string, number>();

    for (const link of allLinks) {
      for (const end of [link.from, link.to]) {
        counts.set(end, (counts.get(end) ?? 0) + link.connections.length);
      }
    }

    return counts;
  }, [allLinks]);
  const focus = active ?? (selection?.kind === 'card' ? selection.id : null);
  const near = useMemo(() => {
    if (focus === null) {
      return null;
    }

    const ids = new Set([focus]);

    for (const link of allLinks) {
      if (link.from === focus) {
        ids.add(link.to);
      } else if (link.to === focus) {
        ids.add(link.from);
      }
    }

    return ids;
  }, [allLinks, focus]);
  const byPair = useMemo(() => {
    const pairs = new Map<string, Link[]>();

    for (const link of level.links) {
      pairs.set(linkKey(link), [...(pairs.get(linkKey(link)) ?? []), link]);
    }

    return pairs;
  }, [level]);
  const hoveredLinks = hovered === null ? [] : (byPair.get(hovered.key) ?? []);
  // A dense level draws its connections faintly until a block is in focus.
  const dense = byPair.size > 40;
  const shownJourneyLinks = level.journeyLinks.filter(
    (link) => focus !== null && (link.from === focus || link.to === focus),
  );

  return (
    <div ref={scroller} {...stylex.props(styles.scroller)}>
      <div
        {...stylex.props(
          styles.canvas,
          styles.size(placed.width, placed.height),
        )}
      >
        {placed.container === null ? null : (
          <div
            aria-hidden="true"
            {...stylex.props(styles.container, styles.place(placed.container))}
          >
            <span
              {...stylex.props(styles.rowLabel, styles.tooltipPlace(12, 10))}
            >
              Inside {level.name}
            </span>
          </div>
        )}
        {placed.outsideLabel === null ? null : (
          <span
            aria-hidden="true"
            {...stylex.props(
              styles.rowLabel,
              styles.tooltipPlace(placed.outsideLabel.x, placed.outsideLabel.y),
            )}
          >
            Outside{' '}
            <span {...stylex.props(styles.rowNote)}>
              · what this level imports or is imported by
            </span>
          </span>
        )}
        {placed.journeyRule === null ? null : (
          <>
            <div
              aria-hidden="true"
              {...stylex.props(
                styles.rule,
                styles.place({
                  x: 0,
                  y: placed.journeyRule.y,
                  width: placed.journeyRule.width,
                  height: 0,
                }),
              )}
            />
            <span
              aria-hidden="true"
              {...stylex.props(
                styles.rowLabel,
                styles.tooltipPlace(0, placed.journeyRule.y + 10),
              )}
            >
              Journeys{' '}
              <span {...stylex.props(styles.rowNote)}>
                · links show on hover or selection
              </span>
            </span>
          </>
        )}
        <svg
          aria-hidden="true"
          width={placed.width}
          height={placed.height}
          {...stylex.props(styles.edges)}
        >
          <defs>
            {connectionKinds.map((kind) => (
              <marker
                key={kind}
                id={`arrow-${kind}`}
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
                {...stylex.props(styles[kind])}
              >
                <path d="M 0 0 L 8 4 L 0 8 z" fill="currentColor" />
              </marker>
            ))}
          </defs>
          {[...byPair].map(([key, links]) => {
            const points = placed.edges.get(key);

            if (points === undefined) {
              return null;
            }

            const [first] = links;
            const touches =
              focus === null ||
              (first !== undefined &&
                (first.from === focus || first.to === focus));
            const total = links.reduce(
              (sum, link) => sum + link.connections.length,
              0,
            );
            const start = points[0];
            const next = points[1];
            const mid =
              start === undefined || next === undefined
                ? null
                : { x: (start.x + next.x) / 2, y: (start.y + next.y) / 2 };

            return (
              <g
                key={key}
                onPointerEnter={(event) => {
                  const box =
                    event.currentTarget.ownerSVGElement?.getBoundingClientRect();

                  setHovered({
                    key,
                    at: {
                      x: event.clientX - (box?.left ?? 0) + 12,
                      y: event.clientY - (box?.top ?? 0) + 12,
                    },
                  });
                }}
                onPointerLeave={() => setHovered(null)}
                {...stylex.props(
                  styles.edgeGroup,
                  !touches && styles.faint,
                  focus === null && dense && styles.rest,
                )}
              >
                {links.map((link, position) => {
                  const offset = (position - (links.length - 1) / 2) * 4;
                  const shifted = points.map((point, at) =>
                    at === 0 || at === points.length - 1
                      ? { x: point.x + offset, y: point.y }
                      : { x: point.x + offset, y: point.y },
                  );

                  return (
                    <path
                      key={link.id}
                      d={curve(shifted)}
                      markerEnd={`url(#arrow-${link.kind})`}
                      {...stylex.props(
                        styles.line,
                        styles[link.kind],
                        link.removed && styles.removed,
                        focus !== null && touches && styles.strong,
                      )}
                    />
                  );
                })}
                <path d={curve(points)} {...stylex.props(styles.hit)} />
                {total > 1 && mid !== null ? (
                  <g>
                    <circle
                      cx={mid.x}
                      cy={mid.y}
                      r={8}
                      {...stylex.props(styles.badge)}
                    />
                    <text
                      x={mid.x}
                      y={mid.y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      {...stylex.props(styles.badgeText)}
                    >
                      {total}
                    </text>
                  </g>
                ) : null}
              </g>
            );
          })}
          {shownJourneyLinks.map((link) => {
            const from = placed.cards.get(link.from);
            const to = placed.cards.get(link.to);

            return from === undefined || to === undefined ? null : (
              <path
                key={link.id}
                d={journeyPath(from, to)}
                markerEnd={`url(#arrow-${link.kind})`}
                {...stylex.props(styles.line, styles[link.kind], styles.strong)}
              />
            );
          })}
        </svg>
        {ordered.map(({ card, box, place }) => (
          <CardButton
            key={card.id}
            index={index}
            card={card}
            box={box}
            place={place}
            links={linkCount.get(card.id) ?? 0}
            dimmed={near !== null && !near.has(card.id)}
            selected={selection?.kind === 'card' && selection.id === card.id}
            onActive={setActive}
            onOpen={onOpen}
          />
        ))}
        {hovered === null ? null : (
          <Tooltip
            links={hoveredLinks}
            names={names}
            blocks={index.blocks}
            at={hovered.at}
          />
        )}
      </div>
    </div>
  );
}

function Legend({ level }: { level: Level }) {
  const all = [...level.links, ...level.journeyLinks];
  const count = (kind: MapConnection['kind']) =>
    all
      .filter((link) => link.kind === kind)
      .reduce((sum, link) => sum + link.connections.length, 0);
  const statuses = new Map<string, { status: Status; count: number }>();

  for (const card of level.inside) {
    const entry = statuses.get(card.status.label) ?? {
      status: card.status,
      count: 0,
    };

    entry.count += 1;
    statuses.set(card.status.label, entry);
  }

  return (
    <>
      <ul aria-label="Connection types" {...stylex.props(styles.legendRow)}>
        <li aria-hidden="true" {...stylex.props(styles.legendLabel)}>
          Connections
        </li>
        {connectionKinds.map((kind) => (
          <li
            key={kind}
            {...stylex.props(
              styles.pill,
              count(kind) === 0 && styles.pillEmpty,
            )}
          >
            <LineSample kind={kind} />
            {connectionLabels[kind]}
            <span {...stylex.props(styles.pillCount)}>{count(kind)}</span>
          </li>
        ))}
        <li {...stylex.props(styles.pill)}>
          <LineSample kind="imports" removed />
          Import removed
        </li>
      </ul>
      <ul aria-label="Block status" {...stylex.props(styles.legendRow)}>
        <li aria-hidden="true" {...stylex.props(styles.legendLabel)}>
          Status
        </li>
        {[...statuses.values()].map(({ status, count: total }) => (
          <li key={status.label} {...stylex.props(styles.pill)}>
            <StatusChip status={status} />
            <span {...stylex.props(styles.pillCount)}>{total}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function ConnectionRows({
  title,
  direction,
  card,
  links,
  names,
  blocks,
  onSelect,
}: {
  title: string;
  direction: 'to' | 'from';
  card: Card;
  links: readonly Link[];
  names: ReadonlyMap<string, string>;
  blocks: ReadonlyMap<string, MapBlock>;
  onSelect: (id: string) => void;
}) {
  const rows = links
    .filter((link) => (direction === 'to' ? link.from : link.to) === card.id)
    .flatMap((link) =>
      link.connections.map((connection) => ({ link, connection })),
    );

  return (
    <section {...stylex.props(styles.group)}>
      <h4 {...stylex.props(styles.panelHeading)}>
        {title} ({rows.length})
      </h4>
      {rows.length === 0 ? (
        <p {...stylex.props(styles.text, styles.muted)}>None.</p>
      ) : (
        <ul {...stylex.props(styles.list)}>
          {rows.map(({ link, connection }, position) => {
            const other = direction === 'to' ? link.to : link.from;

            return (
              <li
                key={`${link.id} ${position}`}
                {...stylex.props(styles.connection)}
              >
                <span {...stylex.props(styles.connectionHead)}>
                  <LineSample kind={connection.kind} removed={link.removed} />
                  <span
                    {...stylex.props(styles.kindWord, styles[connection.kind])}
                  >
                    {connectionLabels[connection.kind].toLowerCase()}
                  </span>
                  <span {...stylex.props(styles.muted)}>{direction}</span>
                  <button
                    type="button"
                    onClick={() => onSelect(other)}
                    {...stylex.props(styles.linkButton)}
                  >
                    {names.get(other) ?? other}
                  </button>
                </span>
                <details>
                  <summary {...stylex.props(styles.reason, styles.summary)}>
                    {connectionText(connection, blocks)}
                  </summary>
                  <p {...stylex.props(styles.text, styles.muted)}>
                    Source: {connectionSources[connection.kind]}.
                  </p>
                  <Evidence evidence={connection.evidence} />
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function sourceArtifact(result: Comparison, file: string): string | null {
  for (const journey of result.journeys) {
    for (const item of journey.candidate.artifacts) {
      if (
        item.integrity === 'verified' &&
        item.path.endsWith(`/candidate/source/${file}`)
      ) {
        return item.path;
      }
    }
  }

  return null;
}

function Sources({ index, card }: { index: MapIndex; card: Card }) {
  if (card.kind === 'package') {
    return (
      <section {...stylex.props(styles.group)}>
        <h4 {...stylex.props(styles.panelHeading)}>
          Packages ({card.packages.length})
        </h4>
        <ul {...stylex.props(styles.list)}>
          {card.packages.map((name) => (
            <li key={name} {...stylex.props(styles.mono)}>
              {name}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const files = sourceFiles(card);

  if (files.length === 0) {
    return null;
  }

  return (
    <section {...stylex.props(styles.group)}>
      <h4 {...stylex.props(styles.panelHeading)}>
        {sourcesHeading(card, files.length)}
      </h4>
      <ul {...stylex.props(styles.list)}>
        {files.map((file) => {
          const artifact =
            card.kind === 'outside-files'
              ? null
              : sourceArtifact(index.result, file);
          const shown = repoPath(index.scope, file);

          return (
            <li key={file} {...stylex.props(styles.mono)}>
              {artifact === null ? (
                shown
              ) : (
                <EvidenceLink href={`./${artifact}`}>{shown}</EvidenceLink>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function sourceFiles(card: Card): string[] {
  switch (card.kind) {
    case 'file':
      return [card.path];
    case 'directory':
      return card.changed.map((file) => file.path);
    case 'outside-files':
      return card.files.map((file) => file.path);
    default:
      return [];
  }
}

function sourcesHeading(card: Card, count: number): string {
  if (card.kind === 'file') {
    return 'Source';
  }

  return card.kind === 'outside-files'
    ? `Files (${count})`
    : `Changed files (${count})`;
}

function Parts({
  index,
  card,
  onOpen,
}: {
  index: MapIndex;
  card: Card;
  onOpen: (card: Card) => void;
}) {
  if (card.kind !== 'directory') {
    return null;
  }

  const parts = children(index, card.path);

  return (
    <section {...stylex.props(styles.group)}>
      <h4 {...stylex.props(styles.panelHeading)}>Parts ({parts.length})</h4>
      <ul {...stylex.props(styles.list)}>
        {parts.map((part) => (
          <li key={part.id}>
            <button
              type="button"
              onClick={() => onOpen(part)}
              {...stylex.props(styles.partRow)}
            >
              <span>
                {part.name}
                {hasParts(part) ? ' ›' : ''}
              </span>
              <StatusChip status={part.status} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function JourneyFacts({ index, card }: { index: MapIndex; card: Card }) {
  if (card.kind === 'removed-journey') {
    return (
      <section {...stylex.props(styles.group)}>
        <h4 {...stylex.props(styles.panelHeading)}>
          Checks ({card.checks.length})
        </h4>
        <ul {...stylex.props(styles.list)}>
          {card.checks.map((check) => (
            <li key={check.id} {...stylex.props(styles.connectionHead)}>
              <ToneChip
                tone={verdictTones[check.verdict]}
                label={verdictLabels[check.verdict]}
              />
              {check.name}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  if (card.kind !== 'journey') {
    return null;
  }

  const lines = recipeLines(index.result).filter((line) =>
    card.recipe.some((check) => line.includes(check.name)),
  );

  return (
    <>
      <section {...stylex.props(styles.group)}>
        <h4 {...stylex.props(styles.panelHeading)}>
          Checks ({card.journey.checks.length})
        </h4>
        <ul {...stylex.props(styles.list)}>
          {card.journey.checks.map((check) => (
            <li key={check.id} {...stylex.props(styles.connectionHead)}>
              <ToneChip
                tone={verdictTones[check.verdict]}
                label={verdictLabels[check.verdict]}
              />
              {check.name}
            </li>
          ))}
        </ul>
      </section>
      {lines.length === 0 ? null : (
        <section {...stylex.props(styles.group)}>
          <h4 {...stylex.props(styles.panelHeading)}>
            Changed by observed.json ({lines.length})
          </h4>
          <ul {...stylex.props(styles.list)}>
            {lines.map((line) => (
              <li key={line} {...stylex.props(styles.text)}>
                {line}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function VerdictEvidence({
  result,
  map,
}: {
  result: Comparison;
  map: RecordedMap;
}) {
  const failing = verdictChecks(result);

  if (failing.length === 0) {
    return (
      <p {...stylex.props(styles.text)}>
        No check failed or is unknown. Select a block to see its evidence.
      </p>
    );
  }

  return (
    <section {...stylex.props(styles.group)}>
      <h4 {...stylex.props(styles.panelHeading)}>Evidence for the verdict</h4>
      <ul {...stylex.props(styles.list)}>
        {failing.map(({ journey, index, check }) => {
          const location = anchorLocation(journey, check);
          const evidence = [
            ...new Map(
              map.connections
                .filter(
                  (connection) =>
                    connection.kind === 'checked-by' &&
                    connection.check === check.id &&
                    connection.to === `journey:${index + 1}`,
                )
                .flatMap((connection) => connection.evidence)
                .map((item) => [JSON.stringify(item), item]),
            ).values(),
          ];

          return (
            <li
              key={`${index}-${check.id}`}
              {...stylex.props(styles.connection)}
            >
              <span {...stylex.props(styles.connectionHead)}>
                <ToneChip
                  tone={verdictTones[check.verdict]}
                  label={verdictLabels[check.verdict]}
                />
                <strong>{check.name}</strong>
              </span>
              <p {...stylex.props(styles.text)}>{check.detail}</p>
              {location === null ? null : (
                <p {...stylex.props(styles.text, styles.muted)}>
                  {location.words}{' '}
                  <span {...stylex.props(styles.mono)}>{location.place}</span>
                </p>
              )}
              {evidence.length === 0 ? null : <Evidence evidence={evidence} />}
              <a
                href={`#${result.journeys.length > 1 ? `journey-${index + 1}-` : ''}checks`}
                {...stylex.props(styles.linkButton)}
              >
                Open the checks of this journey
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Panel({
  index,
  level,
  card,
  onOpen,
  onSelect,
  panelRef,
}: {
  index: MapIndex;
  level: Level;
  card: Card | null;
  onOpen: (card: Card) => void;
  onSelect: (id: string) => void;
  panelRef: RefObject<HTMLElement | null>;
}) {
  const names = new Map(
    [...level.inside, ...level.outside, ...level.journeys].map((item) => [
      item.id,
      item.name,
    ]),
  );
  const links = [...level.links, ...level.journeyLinks];
  const root = level.path === index.root;
  const path =
    card === null
      ? root
        ? null
        : `${repoPath(index.scope, level.path)}/`
      : cardPath(index, card);

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      aria-label="Selection"
      {...stylex.props(styles.panel)}
    >
      <div {...stylex.props(styles.group)}>
        <span {...stylex.props(styles.titleRow)}>
          <span {...stylex.props(styles.chip, styles.kindChip)}>
            {card === null
              ? root
                ? 'project'
                : 'directory'
              : cardKinds[card.kind]}
          </span>
          {card === null ? null : <StatusChip status={card.status} />}
        </span>
        <h3 {...stylex.props(styles.panelName)}>
          {card === null ? level.name : card.name}
        </h3>
        {path === null ? null : (
          <p {...stylex.props(styles.mono, styles.muted)}>{path}</p>
        )}
        <p {...stylex.props(styles.text)}>
          {card === null ? scopeLine(index.scope) : cardSentence(index, card)}
        </p>
      </div>
      {card === null ? (
        <VerdictEvidence result={index.result} map={index.map} />
      ) : (
        <>
          <Sources index={index} card={card} />
          <Parts index={index} card={card} onOpen={onOpen} />
          <JourneyFacts index={index} card={card} />
          {card.kind === 'outside-files' ? null : (
            <>
              <ConnectionRows
                title="Outgoing"
                direction="to"
                card={card}
                links={links}
                names={names}
                blocks={index.blocks}
                onSelect={onSelect}
              />
              <ConnectionRows
                title="Incoming"
                direction="from"
                card={card}
                links={links}
                names={names}
                blocks={index.blocks}
                onSelect={onSelect}
              />
            </>
          )}
        </>
      )}
    </aside>
  );
}

function ScopeTable({ result }: { result: Comparison }) {
  const { rows, notes } = scopeTable(result);

  return (
    <div
      role="region"
      aria-label="Changed files table"
      tabIndex={0}
      {...stylex.props(styles.tableWrap)}
    >
      <table {...stylex.props(styles.table)}>
        <caption {...stylex.props(styles.caption)}>
          Each changed file and the evidence that touched it
        </caption>
        <thead>
          <tr>
            {['File', 'Change', 'Relation', 'Evidence'].map((label) => (
              <th
                key={label}
                scope="col"
                {...stylex.props(styles.cell, styles.headCell)}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.path}>
              <th scope="row" {...stylex.props(styles.cell, styles.mono)}>
                {row.path}
              </th>
              <td {...stylex.props(styles.cell)}>{row.change}</td>
              <td {...stylex.props(styles.cell)}>
                <ToneChip tone={row.chip.tone} label={row.chip.label} />
              </td>
              <td {...stylex.props(styles.cell, styles.text)}>{row.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {notes.length === 0 ? null : (
        <ul {...stylex.props(styles.list)}>
          {notes.map((note) => (
            <li key={note} {...stylex.props(styles.text, styles.muted)}>
              {note}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MapSection({
  result,
  map,
  scope,
  view,
  toolbar,
}: {
  result: Comparison;
  map: RecordedMap;
  scope: RecordedScope;
  view: 'map' | 'table';
  toolbar: ReactNode;
}) {
  const index = useMemo(
    () => indexMap(result, map, scope),
    [result, map, scope],
  );
  const [directory, setDirectory] = useState(index.root);
  const [selection, setSelection] = useState<Selection>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const panel = useRef<HTMLElement>(null);
  const level = useMemo(() => openLevel(index, directory), [index, directory]);
  const root = directory === index.root;
  const cards = useMemo(
    () =>
      new Map(
        [...level.inside, ...level.outside, ...level.journeys].map((card) => [
          card.id,
          card,
        ]),
      ),
    [level],
  );
  const selected =
    selection === null ? null : (cards.get(selection.id) ?? null);
  const linkTotal = level.links.reduce(
    (sum, link) => sum + link.connections.length,
    0,
  );
  const journeyTotal = level.journeyLinks.reduce(
    (sum, link) => sum + link.connections.length,
    0,
  );

  const go = (next: string, focus: string | null) => {
    setDirectory(next);
    setSelection(null);
    setFocusId(focus);
    const opened = openLevel(index, next);

    setAnnouncement(`Opened ${opened.name}: ${opened.inside.length} blocks.`);
  };

  const open = (card: Card) => {
    if (card.kind === 'directory' && level.inside.includes(card)) {
      go(card.path, null);

      return;
    }

    if (
      card.kind === 'directory' &&
      !level.inside.some((item) => item.id === card.id)
    ) {
      go(card.path, null);

      return;
    }

    setSelection(
      selection?.id === card.id ? null : { kind: 'card', id: card.id },
    );
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') {
      return;
    }

    if (selection !== null) {
      event.preventDefault();
      setFocusId(selection.id);
      setSelection(null);

      return;
    }

    const up = parentLevel(index, directory);

    if (up !== null) {
      event.preventDefault();
      go(up, `directory:${directory}`);
    }
  };

  const trail = levelTrail(index, directory);

  return (
    <div onKeyDown={onKeyDown} {...stylex.props(styles.section)}>
      <div {...stylex.props(styles.main)}>
        <header {...stylex.props(styles.header)}>
          {trail.length > 1 ? (
            <nav aria-label="Map level">
              <ol {...stylex.props(styles.trail)}>
                {trail.map((path, position) => (
                  <li key={path} {...stylex.props(styles.titleRow)}>
                    {position === 0 ? null : <span aria-hidden="true">/</span>}
                    <button
                      type="button"
                      aria-current={path === directory ? 'location' : undefined}
                      onClick={() => go(path, null)}
                      {...stylex.props(styles.linkButton, styles.mono)}
                    >
                      {position === 0
                        ? result.title
                        : (path.split('/').at(-1) ?? path)}
                    </button>
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}
          <div {...stylex.props(styles.titleRow)}>
            <h2 id="change-map-title" {...stylex.props(styles.title)}>
              {root ? 'Change map' : level.name}
            </h2>
            <span {...stylex.props(styles.chip, styles.kindChip)}>
              {root ? 'project' : 'directory'}
            </span>
            {toolbar}
          </div>
          <p {...stylex.props(styles.lead)}>{scopeLine(scope)}</p>
          <p {...stylex.props(styles.counts)}>
            {level.inside.length} blocks · {linkTotal} connections ·{' '}
            {level.outside.length} outside
            {journeyTotal === 0
              ? ''
              : ` · ${journeyTotal} journey links show on hover`}
          </p>
          {view === 'map' ? (
            <>
              <Legend level={level} />
              <p {...stylex.props(styles.hint)}>
                Arrows point from the importer to the imported file. Select a
                block with parts to open it. Escape goes up.
              </p>
            </>
          ) : null}
          <p aria-live="polite" {...stylex.props(styles.srOnly)}>
            {announcement}
          </p>
        </header>
        {view === 'map' ? (
          <MapCanvas
            index={index}
            level={level}
            root={root}
            selection={selection}
            focusId={focusId}
            onOpen={open}
          />
        ) : (
          <ScopeTable result={result} />
        )}
      </div>
      <Panel
        index={index}
        level={level}
        card={selected}
        onOpen={open}
        onSelect={(id) => {
          const card = cards.get(id);

          if (card !== undefined) {
            open(card);
          }
        }}
        panelRef={panel}
      />
    </div>
  );
}

export function ChangeScopeView({
  result,
  scope,
}: {
  result: Comparison;
  scope: RecordedScope;
}) {
  const map = result.changeMap.kind === 'recorded' ? result.changeMap : null;
  const [view, setView] = useState<'map' | 'table'>(
    map === null ? 'table' : 'map',
  );
  const captured = scope.files.filter((file) => file.captured).length;

  if (map === null || captured === 0) {
    return (
      <section
        aria-labelledby="change-map-title"
        {...stylex.props(styles.quiet)}
      >
        <h2 id="change-map-title" {...stylex.props(styles.heading)}>
          Changed files
        </h2>
        <p {...stylex.props(styles.text)}>{scopeLine(scope)}</p>
        {map === null &&
        result.changeMap.kind === 'unavailable' &&
        captured > 0 ? (
          <p {...stylex.props(styles.text, styles.muted)}>
            Map unavailable: {result.changeMap.reason}
          </p>
        ) : null}
        {captured > 0 ? <ScopeTable result={result} /> : null}
      </section>
    );
  }

  const toolbar = (
    <span
      role="group"
      aria-label="Change scope view"
      {...stylex.props(styles.titleRow)}
    >
      {(['map', 'table'] as const).map((item) => (
        <button
          key={item}
          type="button"
          aria-pressed={view === item}
          onClick={() => setView(item)}
          {...stylex.props(styles.toggle, view === item && styles.pressed)}
        >
          {item === 'map' ? 'Map' : 'Table'}
        </button>
      ))}
    </span>
  );

  return (
    <section aria-labelledby="change-map-title">
      <MapSection
        result={result}
        map={map}
        scope={scope}
        view={view}
        toolbar={toolbar}
      />
    </section>
  );
}
