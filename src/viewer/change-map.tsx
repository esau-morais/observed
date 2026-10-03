import * as stylex from '@stylexjs/stylex';
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { fileDetail, scopeLine } from '../change-scope-text';
import type {
  Comparison,
  MapBlock,
  MapConnection,
  MapEvidence,
  ScopeFile,
} from '../comparison-model';
import {
  anchorLocation,
  toneSymbols,
  verdictLabels,
  verdictTones,
  type Tone,
} from '../result-text';
import { fonts, geometry, media } from './constants.stylex';
import { EvidenceLink, Screenshot } from './evidence';
import { HeadingLevel } from './heading';
import { layoutMap, type Box, type Layout } from './map-layout';
import {
  blockName,
  blockTitle,
  commonDirectory,
  connectionKinds,
  connectionLabels,
  connectionSources,
  connectionText,
  isJourneyConnection,
  parentDirectory,
  related,
  relationChip,
  scopeFiles,
  scopeTable,
  verdictChecks,
  visibleMap,
  type Chip as ChipValue,
  type RecordedMap,
  type RecordedScope,
} from './map-model';
import { colors } from './tokens.stylex';

const styles = stylex.create({
  section: { display: 'grid', gap: 16, minWidth: 0 },
  heading: {
    fontSize: '1.5rem',
    fontWeight: 500,
    letterSpacing: '-0.02em',
    lineHeight: 1.2,
  },
  subheading: { fontSize: '1.0625rem', fontWeight: 500, lineHeight: 1.35 },
  text: { color: colors.textSecondary, maxWidth: '68ch' },
  small: { color: colors.textMuted, fontSize: '0.8125rem' },
  mono: {
    fontFamily: fonts.mono,
    fontSize: '0.8125rem',
    overflowWrap: 'anywhere',
  },
  toolbar: {
    alignItems: 'center',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  toggle: {
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
    fontFamily: fonts.sans,
    fontSize: '0.875rem',
    fontWeight: 500,
    minHeight: geometry.target,
    outlineColor: {
      default: 'transparent',
      ':focus-visible': colors.focus,
      [media.forcedColors]: 'Highlight',
    },
    outlineOffset: 3,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
    paddingInline: 16,
  },
  pressed: {
    backgroundColor: colors.action,
    borderColor: colors.action,
    color: colors.onAction,
  },
  workspace: {
    display: 'grid',
    gap: 16,
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      [media.desktop]: 'minmax(0, 1fr) 20rem',
    },
    minWidth: 0,
  },
  mapArea: { display: 'grid', gap: 8, minWidth: 0, alignContent: 'start' },
  scroller: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: geometry.radius,
    borderStyle: 'solid',
    borderWidth: 1,
    maxHeight: '70vh',
    minHeight: 160,
    overflow: 'auto',
    outlineColor: {
      default: 'transparent',
      ':focus-visible': colors.focus,
      [media.forcedColors]: 'Highlight',
    },
    outlineOffset: 2,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
  },
  canvas: { position: 'relative' },
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
  group: {
    borderColor: colors.border,
    borderRadius: 8,
    borderStyle: 'solid',
    borderWidth: 1,
    boxSizing: 'border-box',
    position: 'absolute',
  },
  journeyGroup: { borderStyle: 'dashed' },
  groupLabel: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderRadius: 6,
    borderWidth: 0,
    color: colors.textSecondary,
    cursor: 'pointer',
    display: 'flex',
    fontFamily: fonts.mono,
    fontSize: '0.75rem',
    gap: 6,
    insetBlockStart: 4,
    insetInlineStart: 6,
    minHeight: 28,
    outlineColor: {
      default: 'transparent',
      ':focus-visible': colors.focus,
      [media.forcedColors]: 'Highlight',
    },
    outlineOffset: 1,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
    paddingInline: 6,
    position: 'absolute',
    textDecoration: {
      default: 'none',
      [media.hover]: { default: 'none', ':hover': 'underline' },
    },
  },
  layerLabel: {
    color: colors.textMuted,
    fontFamily: fonts.mono,
    fontSize: '0.75rem',
    insetBlockStart: 10,
    insetInlineStart: 12,
    position: 'absolute',
  },
  block: {
    alignContent: 'center',
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
    gap: 4,
    justifyItems: 'start',
    minWidth: 0,
    outlineColor: {
      default: 'transparent',
      ':focus-visible': colors.focus,
      [media.forcedColors]: 'Highlight',
    },
    outlineOffset: 2,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
    paddingBlock: 6,
    paddingInline: 10,
    position: 'absolute',
    textAlign: 'start',
    transitionDuration: { default: '120ms', [media.reduceMotion]: '0ms' },
    transitionProperty: 'opacity',
  },
  context: { backgroundColor: colors.surface, borderStyle: 'dashed' },
  selected: {
    borderColor: colors.focus,
    boxShadow: `0 0 0 2px ${colors.focus}`,
  },
  dimmed: { opacity: 0.35 },
  blockName: {
    fontSize: '0.8125rem',
    fontWeight: 500,
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  eyebrow: {
    color: colors.textMuted,
    fontFamily: fonts.mono,
    fontSize: '0.6875rem',
    letterSpacing: '0.06em',
  },
  chip: {
    alignItems: 'center',
    borderRadius: 4,
    display: 'inline-flex',
    fontSize: '0.75rem',
    fontWeight: 500,
    gap: 4,
    justifySelf: 'start',
    paddingBlock: 1,
    paddingInline: 6,
    whiteSpace: 'nowrap',
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
  faint: { opacity: 0.25 },
  removed: { opacity: 0.6 },
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
  legend: {
    display: 'flex',
    flexWrap: 'wrap',
    columnGap: 20,
    listStyle: 'none',
    margin: 0,
    padding: 0,
    rowGap: 6,
  },
  legendItem: {
    alignItems: 'center',
    color: colors.textSecondary,
    display: 'flex',
    fontSize: '0.8125rem',
    gap: 8,
  },
  panel: {
    alignContent: 'start',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: geometry.radius,
    borderStyle: 'solid',
    borderWidth: 1,
    display: 'grid',
    gap: 12,
    minWidth: 0,
    padding: { default: 16, [media.desktop]: 20 },
  },
  list: {
    display: 'grid',
    gap: 6,
    listStyle: 'none',
    margin: 0,
    padding: 0,
  },
  linkButton: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    color: colors.text,
    cursor: 'pointer',
    fontFamily: fonts.sans,
    fontSize: '0.875rem',
    minHeight: 32,
    outlineColor: {
      default: 'transparent',
      ':focus-visible': colors.focus,
      [media.forcedColors]: 'Highlight',
    },
    outlineOffset: 1,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
    padding: 0,
    textAlign: 'start',
    textDecoration: 'underline',
    textUnderlineOffset: 3,
  },
  connectionRow: { alignItems: 'baseline', display: 'flex', gap: 8 },
  path: { flexShrink: 0, height: 10, width: 28 },
  tableWrap: { maxWidth: '100%', overflowX: 'auto' },
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
});

type Selection =
  { kind: 'block'; id: string } | { kind: 'connection'; index: number } | null;

function Chip({ chip }: { chip: ChipValue }) {
  return (
    <span {...stylex.props(styles.chip, styles[chip.tone])}>
      <span aria-hidden="true">{chip.symbol}</span>
      {chip.label}
    </span>
  );
}

function ToneChip({ tone, label }: { tone: Tone; label: string }) {
  return <Chip chip={{ tone, label, symbol: toneSymbols[tone] }} />;
}

function LineSample({ kind }: { kind: MapConnection['kind'] }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 28 10" {...stylex.props(styles.path)}>
      <line
        x1="0"
        y1="5"
        x2="28"
        y2="5"
        {...stylex.props(styles.line, styles[kind])}
      />
    </svg>
  );
}

function Legend() {
  return (
    <ul aria-label="Connection types" {...stylex.props(styles.legend)}>
      {connectionKinds.map((kind) => (
        <li key={kind} {...stylex.props(styles.legendItem)}>
          <LineSample kind={kind} />
          {connectionLabels[kind]}
        </li>
      ))}
    </ul>
  );
}

function Evidence({ evidence }: { evidence: readonly MapEvidence[] }) {
  return (
    <ul {...stylex.props(styles.list)}>
      {evidence.map((item, index) => (
        <li key={index} {...stylex.props(styles.mono)}>
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

function ConnectionList({
  map,
  blocks,
  connections,
  select,
}: {
  map: RecordedMap;
  blocks: ReadonlyMap<string, MapBlock>;
  connections: readonly MapConnection[];
  select: (selection: Selection) => void;
}) {
  return connections.length === 0 ? (
    <p {...stylex.props(styles.small)}>No connection is recorded.</p>
  ) : (
    <ul {...stylex.props(styles.list)}>
      {connections.map((connection) => (
        <li
          key={map.connections.indexOf(connection)}
          {...stylex.props(styles.connectionRow)}
        >
          <LineSample kind={connection.kind} />
          <button
            type="button"
            onClick={() =>
              select({
                kind: 'connection',
                index: map.connections.indexOf(connection),
              })
            }
            {...stylex.props(styles.linkButton)}
          >
            {connectionLabels[connection.kind]}:{' '}
            {connectionText(connection, blocks)}
          </button>
        </li>
      ))}
    </ul>
  );
}

function lineCount(ranges: readonly (readonly [number, number])[]): number {
  return ranges.reduce((sum, [start, end]) => sum + end - start + 1, 0);
}

function ranges(list: readonly (readonly [number, number])[]): string {
  return list
    .map(([start, end]) => (start === end ? `${start}` : `${start}-${end}`))
    .join(', ');
}

function FileFacts({ file }: { file: ScopeFile }) {
  return (
    <>
      <p {...stylex.props(styles.small)}>Changed file · {file.change}</p>
      <Chip chip={relationChip(file.relation)} />
      {'lines' in file ? (
        <p {...stylex.props(styles.text)}>
          Changed lines that ran: {lineCount(file.lines.ran)}
          {file.lines.ran.length === 0 ? '' : ` (${ranges(file.lines.ran)})`}.
          Changed lines that did not run: {lineCount(file.lines.notRan)}
          {file.lines.notRan.length === 0
            ? ''
            : ` (${ranges(file.lines.notRan)})`}
          .
        </p>
      ) : null}
    </>
  );
}

function BlockPanel({
  result,
  map,
  scope,
  blocks,
  block,
  select,
}: {
  result: Comparison;
  map: RecordedMap;
  scope: RecordedScope;
  blocks: ReadonlyMap<string, MapBlock>;
  block: MapBlock;
  select: (selection: Selection) => void;
}) {
  const file =
    block.kind === 'file' ? scopeFiles(scope).get(block.path) : undefined;
  const connections = map.connections.filter(
    (connection) => connection.from === block.id || connection.to === block.id,
  );
  const evidence = connections.flatMap((connection) => connection.evidence);
  const artifacts = [
    ...new Set(
      evidence.flatMap((item) => (item.kind === 'artifact' ? [item.path] : [])),
    ),
  ];

  return (
    <>
      <h3 {...stylex.props(styles.subheading, styles.mono)}>
        {blockTitle(block)}
      </h3>
      {file === undefined ? (
        <p {...stylex.props(styles.small)}>
          {
            {
              file: 'Unchanged file. It gives context and has no relation.',
              package: 'Package outside the captured source.',
              journey:
                'Journey. Its connections show what it ran and requested.',
              route: 'Route in the request ledger.',
            }[block.kind]
          }
        </p>
      ) : (
        <>
          <FileFacts file={file} />
          <p {...stylex.props(styles.text)}>{fileDetail(result, file)}</p>
        </>
      )}
      {block.kind === 'file' && block.imports.kind === 'unavailable' ? (
        <p {...stylex.props(styles.small)}>
          No import connections: {block.imports.reason}
        </p>
      ) : null}
      <h4 {...stylex.props(styles.subheading)}>Connections</h4>
      <ConnectionList
        map={map}
        blocks={blocks}
        connections={connections}
        select={select}
      />
      {artifacts.length === 0 ? null : (
        <>
          <h4 {...stylex.props(styles.subheading)}>Artifacts</h4>
          <Evidence
            evidence={artifacts.map((path) => ({ kind: 'artifact', path }))}
          />
        </>
      )}
    </>
  );
}

function ConnectionPanel({
  connection,
  blocks,
  select,
}: {
  connection: MapConnection;
  blocks: ReadonlyMap<string, MapBlock>;
  select: (selection: Selection) => void;
}) {
  return (
    <>
      <h3 {...stylex.props(styles.subheading)}>
        {connectionLabels[connection.kind]}
      </h3>
      <p {...stylex.props(styles.text)}>
        {connectionText(connection, blocks)}.
      </p>
      <p {...stylex.props(styles.small)}>
        Source: {connectionSources[connection.kind]}.
      </p>
      <ul {...stylex.props(styles.list)}>
        {[connection.from, connection.to].map((id) => {
          const block = blocks.get(id);

          return block === undefined ? null : (
            <li key={id}>
              <button
                type="button"
                onClick={() => select({ kind: 'block', id })}
                {...stylex.props(styles.linkButton)}
              >
                {blockTitle(block)}
              </button>
            </li>
          );
        })}
      </ul>
      <h4 {...stylex.props(styles.subheading)}>Evidence</h4>
      <Evidence evidence={connection.evidence} />
    </>
  );
}

function VerdictPanel({
  result,
  map,
  select,
}: {
  result: Comparison;
  map: RecordedMap;
  select: (selection: Selection) => void;
}) {
  const failing = verdictChecks(result);
  const multiple = result.journeys.length > 1;

  if (failing.length === 0) {
    const [journey] = result.journeys;

    return (
      <>
        <h3 {...stylex.props(styles.subheading)}>Captured application</h3>
        <p {...stylex.props(styles.small)}>
          No check failed or is unknown. Select a block to see its evidence.
        </p>
        {journey === undefined ? null : (
          <HeadingLevel value={4}>
            <Screenshot
              side={journey.candidate}
              label="Candidate"
              highlight={null}
            />
          </HeadingLevel>
        )}
      </>
    );
  }

  return (
    <>
      <h3 {...stylex.props(styles.subheading)}>Evidence for the verdict</h3>
      <ul {...stylex.props(styles.list)}>
        {failing.map(({ journey, index, check }) => {
          const tone = verdictTones[check.verdict];
          const location = anchorLocation(journey, check);
          const files = map.connections.filter(
            (connection) =>
              connection.kind === 'checked-by' && connection.check === check.id,
          );
          const prefix = multiple ? `journey-${index + 1}-` : '';

          return (
            <li key={`${index}-${check.id}`} {...stylex.props(styles.section)}>
              <ToneChip tone={tone} label={verdictLabels[check.verdict]} />
              <p>
                {check.name}
                {multiple ? ` · ${journey.title}` : ''}
              </p>
              <p {...stylex.props(styles.text)}>{check.detail}</p>
              {location === null ? null : (
                <p {...stylex.props(styles.small)}>
                  {location.words}{' '}
                  <span {...stylex.props(styles.mono)}>{location.place}</span>
                </p>
              )}
              {files.map((connection) => (
                <button
                  key={connection.from}
                  type="button"
                  onClick={() => select({ kind: 'block', id: connection.from })}
                  {...stylex.props(styles.linkButton)}
                >
                  Show {connection.from.slice('file:'.length)} on the map
                </button>
              ))}
              <a href={`#${prefix}checks`} {...stylex.props(styles.linkButton)}>
                Open the checks of this journey
              </a>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function edgePath(from: Box, to: Box): string {
  const start = { x: from.x + from.width / 2, y: from.y + from.height };
  const end = { x: to.x + to.width / 2, y: to.y };
  const bend = Math.max(24, Math.abs(end.y - start.y) / 2);

  return `M ${start.x} ${start.y} C ${start.x} ${start.y + bend}, ${end.x} ${end.y - bend}, ${end.x} ${end.y}`;
}

function blockLabel(
  block: MapBlock,
  scope: RecordedScope,
  count: number,
): string {
  const file =
    block.kind === 'file' ? scopeFiles(scope).get(block.path) : undefined;
  const connections = `${count} ${count === 1 ? 'connection' : 'connections'}`;

  if (block.kind !== 'file') {
    return `${blockTitle(block)}, ${block.kind}, ${connections}`;
  }

  return file === undefined
    ? `${blockTitle(block)}, unchanged, ${connections}`
    : `${blockTitle(block)}, ${file.change}, ${relationChip(file.relation).label}, ${connections}`;
}

function MapBlockButton({
  block,
  box,
  scope,
  count,
  dimmed,
  selected,
  onActive,
  select,
}: {
  block: MapBlock;
  box: Box;
  scope: RecordedScope;
  count: number;
  dimmed: boolean;
  selected: boolean;
  onActive: (id: string | null) => void;
  select: (selection: Selection) => void;
}) {
  const file =
    block.kind === 'file' ? scopeFiles(scope).get(block.path) : undefined;
  const eyebrow = {
    file: file === undefined ? 'unchanged' : null,
    package: 'package',
    journey: 'journey',
    route: 'route',
  }[block.kind];

  return (
    <button
      type="button"
      aria-label={blockLabel(block, scope, count)}
      aria-pressed={selected}
      title={blockTitle(block)}
      onClick={() => select(selected ? null : { kind: 'block', id: block.id })}
      onPointerEnter={() => onActive(block.id)}
      onPointerLeave={() => onActive(null)}
      onFocus={() => onActive(block.id)}
      onBlur={() => onActive(null)}
      {...stylex.props(
        styles.block,
        styles.place(box),
        block.kind === 'file' && file === undefined && styles.context,
        selected && styles.selected,
        dimmed && styles.dimmed,
      )}
    >
      {eyebrow === null ? null : (
        <span {...stylex.props(styles.eyebrow)}>{eyebrow}</span>
      )}
      <span {...stylex.props(styles.blockName)}>{blockName(block)}</span>
      {file === undefined ? null : <Chip chip={relationChip(file.relation)} />}
    </button>
  );
}

function MapCanvas({
  map,
  scope,
  directory,
  root,
  setDirectory,
  selection,
  select,
}: {
  map: RecordedMap;
  scope: RecordedScope;
  directory: string;
  root: string;
  setDirectory: (directory: string) => void;
  selection: Selection;
  select: (selection: Selection) => void;
}) {
  const visible = useMemo(() => visibleMap(map, directory), [map, directory]);
  const [layout, setLayout] = useState<{
    value:
      { kind: 'placed'; layout: Layout } | { kind: 'failed'; reason: string };
  } | null>(null);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    let current = true;

    layoutMap(visible).then(
      (value) => {
        if (current) {
          setLayout({ value: { kind: 'placed', layout: value } });
        }
      },
      (error: unknown) => {
        if (current) {
          setLayout({
            value: {
              kind: 'failed',
              reason: error instanceof Error ? error.message : String(error),
            },
          });
        }
      },
    );

    return () => {
      current = false;
    };
  }, [visible]);

  const focus = active ?? (selection?.kind === 'block' ? selection.id : null);
  const near = focus === null ? null : related(map, focus);
  const selectedConnection =
    selection?.kind === 'connection'
      ? map.connections[selection.index]
      : undefined;
  if (layout === null) {
    return <p {...stylex.props(styles.small)}>Laying out the map.</p>;
  }

  if (layout.value.kind === 'failed') {
    return (
      <p {...stylex.props(styles.small)}>
        The map could not be laid out ({layout.value.reason}). The table lists
        the same files.
      </p>
    );
  }

  const placed = layout.value.layout;

  const counts = new Map<string, number>();

  for (const connection of map.connections) {
    for (const end of [connection.from, connection.to]) {
      counts.set(end, (counts.get(end) ?? 0) + 1);
    }
  }

  const items = [
    ...[...placed.directories].map(([path, box]) => ({
      kind: 'directory' as const,
      path,
      box,
    })),
    ...[...placed.blocks].flatMap(([id, box]) => {
      const block = map.blocks.find((item) => item.id === id);

      return block === undefined
        ? []
        : [{ kind: 'block' as const, block, box }];
    }),
  ].sort((left, right) =>
    Math.abs(left.box.y - right.box.y) < 8
      ? left.box.x - right.box.x
      : left.box.y - right.box.y,
  );

  const shownConnections = visible.connections.filter((connection) => {
    if (connection === selectedConnection) {
      return true;
    }

    if (!isJourneyConnection(connection)) {
      return true;
    }

    return (
      focus !== null && (connection.from === focus || connection.to === focus)
    );
  });

  return (
    <div
      role="region"
      aria-label={`Change map of ${directory === '' ? 'the project' : directory}`}
      tabIndex={0}
      {...stylex.props(styles.scroller)}
    >
      <div
        {...stylex.props(
          styles.canvas,
          styles.size(placed.width, placed.height),
        )}
      >
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
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
                {...stylex.props(styles[kind])}
              >
                <path d="M 0 0 L 8 4 L 0 8 z" fill="currentColor" />
              </marker>
            ))}
          </defs>
          {shownConnections.map((connection) => {
            const from = placed.blocks.get(connection.from);
            const to = placed.blocks.get(connection.to);
            const touches =
              focus === null ||
              connection.from === focus ||
              connection.to === focus;

            return from === undefined || to === undefined ? null : (
              <path
                key={map.connections.indexOf(connection)}
                d={edgePath(from, to)}
                markerEnd={`url(#arrow-${connection.kind})`}
                {...stylex.props(
                  styles.line,
                  styles[connection.kind],
                  connection.kind === 'imports' &&
                    connection.change === 'removed' &&
                    styles.removed,
                  !touches && styles.faint,
                )}
              />
            );
          })}
        </svg>
        {placed.journeys === null ? null : (
          <div
            aria-hidden="true"
            {...stylex.props(
              styles.group,
              styles.journeyGroup,
              styles.place(placed.journeys),
            )}
          >
            <span {...stylex.props(styles.layerLabel)}>Journeys</span>
          </div>
        )}
        {items.map((item) =>
          item.kind === 'directory' ? (
            <div
              key={`directory:${item.path}`}
              {...stylex.props(styles.group, styles.place(item.box))}
            >
              <button
                type="button"
                aria-label={
                  item.path === directory
                    ? `Directory ${item.path === '' ? 'project root' : item.path}, shown`
                    : `Open directory ${item.path}`
                }
                onClick={() => setDirectory(item.path)}
                {...stylex.props(styles.groupLabel)}
              >
                {item.path === '' ? './' : `${item.path}/`}
              </button>
            </div>
          ) : (
            <MapBlockButton
              key={item.block.id}
              block={item.block}
              box={item.box}
              scope={scope}
              count={counts.get(item.block.id) ?? 0}
              dimmed={near !== null && !near.has(item.block.id)}
              selected={
                selection?.kind === 'block' && selection.id === item.block.id
              }
              onActive={setActive}
              select={select}
            />
          ),
        )}
      </div>
      {visible.hidden > 0 && directory !== root ? (
        <p {...stylex.props(styles.small)}>
          {visible.hidden === 1
            ? '1 connection leads'
            : `${visible.hidden} connections lead`}{' '}
          outside this directory.
        </p>
      ) : null}
    </div>
  );
}

function ScopeTable({ result }: { result: Comparison }) {
  const { rows, notes } = scopeTable(result);

  return (
    <>
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
                  <Chip chip={row.chip} />
                </td>
                <td {...stylex.props(styles.cell, styles.text)}>
                  {row.detail}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {notes.length === 0 ? null : (
        <ul {...stylex.props(styles.list)}>
          {notes.map((note) => (
            <li key={note} {...stylex.props(styles.small)}>
              {note}
            </li>
          ))}
        </ul>
      )}
    </>
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
  const root = map === null ? '' : commonDirectory(map);
  const [view, setView] = useState<'map' | 'table'>(
    map === null ? 'table' : 'map',
  );
  const [directory, setDirectory] = useState(root);
  const [selection, select] = useState<Selection>(null);
  const blocks = useMemo(
    () => new Map((map?.blocks ?? []).map((block) => [block.id, block])),
    [map],
  );
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && directory !== root && view === 'map') {
      event.preventDefault();
      setDirectory(parentDirectory(directory));
    }
  };

  const selectedBlock =
    selection?.kind === 'block' ? blocks.get(selection.id) : undefined;
  const selectedConnection =
    selection?.kind === 'connection' && map !== null
      ? map.connections[selection.index]
      : undefined;
  const trail =
    directory === root
      ? [root]
      : [
          root,
          ...directory
            .slice(root === '' ? 0 : root.length + 1)
            .split('/')
            .map((_, index, parts) =>
              [root, ...parts.slice(0, index + 1)]
                .filter((part) => part !== '')
                .join('/'),
            ),
        ];

  return (
    <section
      aria-labelledby="change-map-title"
      onKeyDown={onKeyDown}
      {...stylex.props(styles.section)}
    >
      <h2 id="change-map-title" {...stylex.props(styles.heading)}>
        Change map
      </h2>
      <p {...stylex.props(styles.text)}>{scopeLine(scope)}</p>
      <div
        role="group"
        aria-label="Change scope view"
        {...stylex.props(styles.toolbar)}
      >
        {map === null ? null : (
          <button
            type="button"
            aria-pressed={view === 'map'}
            onClick={() => setView('map')}
            {...stylex.props(styles.toggle, view === 'map' && styles.pressed)}
          >
            Map
          </button>
        )}
        <button
          type="button"
          aria-pressed={view === 'table'}
          onClick={() => setView('table')}
          {...stylex.props(styles.toggle, view === 'table' && styles.pressed)}
        >
          Table
        </button>
      </div>
      {map === null && result.changeMap.kind === 'unavailable' ? (
        <p {...stylex.props(styles.small)}>
          Map unavailable: {result.changeMap.reason}
        </p>
      ) : null}
      {view === 'table' || map === null ? (
        <ScopeTable result={result} />
      ) : (
        <div {...stylex.props(styles.workspace)}>
          <div {...stylex.props(styles.mapArea)}>
            <Legend />
            <nav aria-label="Map directory" {...stylex.props(styles.toolbar)}>
              {trail.map((path, index) => (
                <button
                  key={path}
                  type="button"
                  aria-current={path === directory ? 'location' : undefined}
                  onClick={() => setDirectory(path)}
                  {...stylex.props(styles.linkButton, styles.mono)}
                >
                  {index === 0 && path === '' ? './' : `${path}/`}
                </button>
              ))}
              <span {...stylex.props(styles.small)}>
                Enter opens a directory. Escape goes up.
              </span>
            </nav>
            <MapCanvas
              map={map}
              scope={scope}
              directory={directory}
              root={root}
              setDirectory={setDirectory}
              selection={selection}
              select={select}
            />
          </div>
          <aside aria-label="Selection" {...stylex.props(styles.panel)}>
            {selectedBlock !== undefined ? (
              <BlockPanel
                result={result}
                map={map}
                scope={scope}
                blocks={blocks}
                block={selectedBlock}
                select={select}
              />
            ) : null}
            {selectedConnection !== undefined ? (
              <ConnectionPanel
                connection={selectedConnection}
                blocks={blocks}
                select={select}
              />
            ) : null}
            {selection === null ? (
              <VerdictPanel result={result} map={map} select={select} />
            ) : null}
          </aside>
        </div>
      )}
    </section>
  );
}
