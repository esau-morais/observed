import * as stylex from '@stylexjs/stylex';
import { use, useId, useLayoutEffect, useState, type ReactNode } from 'react';
import type { Side, Visual, VisualRegion } from '../comparison-model';
import { describeRevision, shortSource } from '../provenance-text';
import { describeRegion, diffLegend } from '../visual-text';
import { fonts, geometry, media } from './constants.stylex';
import { EvidenceLink, EvidenceUrls } from './evidence';
import { SubHeading } from './heading';
import { colors } from './tokens.stylex';

type Mode = 'side' | 'diff' | 'slider' | 'onion' | 'before' | 'after';

type Size = { width: number; height: number };

const zoomLevels = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
const regionPadding = 24;

const styles = stylex.create({
  focus: {
    outlineColor: { default: colors.focus, [media.forcedColors]: 'Highlight' },
    outlineOffset: 2,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
  },
  root: { display: 'grid', gap: 16, minWidth: 0 },
  toolbar: {
    alignItems: 'center',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
  },
  group: {
    alignItems: 'center',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  segmented: {
    borderColor: colors.borderControl,
    borderRadius: 8,
    borderStyle: 'solid',
    borderWidth: 1,
    display: 'inline-flex',
    flexWrap: 'wrap',
    marginInline: 0,
    padding: 2,
    minWidth: 0,
  },
  legend: {
    clipPath: 'inset(50%)',
    height: 1,
    overflow: 'hidden',
    position: 'absolute',
    whiteSpace: 'nowrap',
    width: 1,
  },
  option: {
    alignItems: 'center',
    borderRadius: 6,
    color: colors.textSecondary,
    cursor: 'pointer',
    display: 'inline-flex',
    fontSize: '0.875rem',
    fontWeight: 500,
    minHeight: geometry.target,
    paddingInline: 12,
    position: 'relative',
    backgroundColor: {
      default: 'transparent',
      [media.hover]: { default: 'transparent', ':hover': colors.surfaceMuted },
    },
    outlineColor: { default: colors.focus, [media.forcedColors]: 'Highlight' },
    outlineOffset: 2,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':has(:focus-visible)': 2 },
  },
  optionSelected: {
    backgroundColor: colors.text,
    color: colors.canvas,
  },
  optionDisabled: { cursor: 'not-allowed', opacity: 0.5 },
  // The native radio stays focusable and announced; its label shows the
  // state and the focus ring, so no control covers the label text.
  radio: {
    clipPath: 'inset(50%)',
    height: 1,
    margin: 0,
    overflow: 'hidden',
    position: 'absolute',
    whiteSpace: 'nowrap',
    width: 1,
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
    cursor: { default: 'pointer', ':disabled': 'not-allowed' },
    display: 'inline-flex',
    fontFamily: fonts.sans,
    fontSize: '0.875rem',
    fontWeight: 500,
    gap: 6,
    justifyContent: 'center',
    minHeight: geometry.target,
    minWidth: geometry.target,
    opacity: { default: 1, ':disabled': 0.5 },
    paddingInline: 12,
  },
  inactive: { cursor: 'not-allowed', opacity: 0.5 },
  icon: { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 },
  withTicks: {
    display: 'grid',
    gap: 4,
    gridTemplateColumns: '8px minmax(0, 1fr)',
  },
  ticks: { position: 'relative' },
  tick: {
    backgroundColor: colors.changed,
    borderRadius: 2,
    cursor: 'pointer',
    left: 0,
    minHeight: 4,
    position: 'absolute',
    right: 0,
  },
  tickSelected: {
    outlineColor: colors.text,
    outlineStyle: 'solid',
    outlineWidth: 2,
  },
  tickAt: (top: string, height: string) => ({ height, top }),
  context: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    listStyle: 'none',
    margin: 0,
    padding: 0,
  },
  chip: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 4,
    color: colors.textSecondary,
    fontFamily: fonts.mono,
    fontSize: '0.75rem',
    paddingBlock: 2,
    paddingInline: 8,
  },
  zoomValue: {
    color: colors.textSecondary,
    fontFamily: fonts.mono,
    fontSize: '0.8125rem',
    fontVariantNumeric: 'tabular-nums',
    minWidth: '4.5ch',
    textAlign: 'center',
  },
  panes: {
    display: 'grid',
    gap: 16,
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      [media.tablet]: 'repeat(2, minmax(0, 1fr))',
    },
  },
  paneBox: { display: 'grid', gap: 8, minWidth: 0, alignContent: 'start' },
  paneHeader: {
    alignItems: 'baseline',
    columnGap: 12,
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  paneTitle: { fontSize: '1.125rem', fontWeight: 500, lineHeight: 1.35 },
  caption: {
    color: colors.textMuted,
    fontSize: '0.8125rem',
    overflowWrap: 'anywhere',
  },
  mono: { fontFamily: fonts.mono, fontSize: '0.8125rem' },
  viewport: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.borderControl,
    borderRadius: geometry.radius,
    borderStyle: 'solid',
    borderWidth: 1,
    maxHeight: { default: '60vh', [media.desktop]: '72vh' },
    overflow: 'auto',
    overscrollBehavior: 'contain',
    position: 'relative',
  },
  frame: { display: 'block', position: 'relative' },
  frameWidth: (width: string) => ({ width }),
  image: {
    display: 'block',
    height: 'auto',
    maxWidth: 'none',
    userSelect: 'none',
    width: '100%',
  },
  pixelated: { imageRendering: 'pixelated' },
  overlayImage: { inset: 0, position: 'absolute' },
  clip: (right: string) => ({ clipPath: `inset(0 ${right} 0 0)` }),
  fade: (opacity: number) => ({ opacity }),
  divider: {
    backgroundColor: colors.text,
    bottom: 0,
    outlineColor: colors.surface,
    outlineStyle: 'solid',
    outlineWidth: 1,
    pointerEvents: 'none',
    position: 'absolute',
    top: 0,
    width: 2,
  },
  dividerAt: (left: string) => ({ left: `calc(${left} - 1px)` }),
  sideTag: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.borderControl,
    borderRadius: 4,
    borderStyle: 'solid',
    borderWidth: 1,
    color: colors.text,
    fontSize: '0.8125rem',
    fontWeight: 500,
    lineHeight: 1.4,
    paddingBlock: 2,
    paddingInline: 8,
    pointerEvents: 'none',
  },
  tags: {
    alignItems: 'flex-start',
    display: 'flex',
    height: 0,
    justifyContent: 'space-between',
    paddingInline: 8,
    position: 'sticky',
    top: 8,
    zIndex: 2,
  },
  region: {
    borderColor: { default: colors.changed, [media.forcedColors]: 'Highlight' },
    borderStyle: 'dashed',
    borderWidth: 2,
    boxSizing: 'border-box',
    outlineColor: colors.surface,
    outlineStyle: 'solid',
    outlineWidth: 1,
    pointerEvents: 'none',
    position: 'absolute',
  },
  regionSelected: { borderStyle: 'solid', borderWidth: 3 },
  regionBox: (left: string, top: string, width: string, height: string) => ({
    height: `calc(${height} + 8px)`,
    left: `calc(${left} - 4px)`,
    top: `calc(${top} - 4px)`,
    width: `calc(${width} + 8px)`,
  }),
  regionNumber: {
    backgroundColor: colors.changed,
    borderRadius: 4,
    color: colors.changedFill,
    fontFamily: fonts.mono,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1.4,
    marginInlineEnd: 4,
    paddingInline: 4,
    position: 'absolute',
    right: '100%',
    top: -2,
  },
  missing: {
    backgroundColor: colors.unknownFill,
    borderRadius: geometry.radius,
    color: colors.unknown,
    padding: 24,
  },
  slider: {
    accentColor: colors.focus,
    minHeight: geometry.target,
    width: '100%',
  },
  sliderRow: {
    alignItems: 'center',
    display: 'grid',
    gap: 12,
    gridTemplateColumns: 'auto minmax(0, 1fr) auto',
  },
  sideWord: { fontWeight: 500 },
  regions: { display: 'grid', gap: 8, minWidth: 0 },
  regionList: {
    display: 'grid',
    gap: 4,
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      [media.desktop]: 'repeat(2, minmax(0, 1fr))',
    },
    listStyle: 'none',
    margin: 0,
    padding: 0,
  },
  regionButton: {
    alignItems: 'baseline',
    backgroundColor: {
      default: 'transparent',
      [media.hover]: { default: 'transparent', ':hover': colors.surfaceMuted },
    },
    borderColor: 'transparent',
    borderRadius: 8,
    borderStyle: 'solid',
    borderWidth: 1,
    color: colors.text,
    columnGap: 8,
    cursor: 'pointer',
    display: 'grid',
    fontFamily: fonts.sans,
    fontSize: '0.875rem',
    gridTemplateColumns: '2rem minmax(0, 1fr)',
    minHeight: geometry.target,
    paddingBlock: 6,
    paddingInline: 8,
    textAlign: 'start',
    width: '100%',
  },
  regionButtonSelected: {
    backgroundColor: colors.changedFill,
    borderColor: colors.changed,
  },
  regionIndex: {
    color: colors.changed,
    fontFamily: fonts.mono,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 500,
  },
  heading: { fontWeight: 500 },
  status: { color: colors.textSecondary, fontSize: '0.875rem' },
  links: { columnGap: 24, display: 'flex', flexWrap: 'wrap', rowGap: 8 },
});

type Box = { x: number; y: number; width: number; height: number };

// The smallest box holding every listed changed region.
function unionOf(regions: readonly Box[]): Box | null {
  const [first, ...rest] = regions;

  if (first === undefined) {
    return null;
  }

  const right = Math.max(...regions.map((region) => region.x + region.width));
  const bottom = Math.max(...regions.map((region) => region.y + region.height));
  const x = Math.min(first.x, ...rest.map((region) => region.x));
  const y = Math.min(first.y, ...rest.map((region) => region.y));

  return { x, y, width: right - x, height: bottom - y };
}

function zoomLabel(zoom: number | 'fit' | 'changes'): string {
  if (zoom === 'fit') {
    return 'Fit width';
  }

  return zoom === 'changes' ? 'Changes' : `${Math.round(zoom * 100)}%`;
}

function percent(value: number, total: number): string {
  return `${(value / total) * 100}%`;
}

function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; disabled?: boolean }[];
  onChange: (value: T) => void;
}) {
  const name = useId();

  return (
    <fieldset {...stylex.props(styles.segmented)}>
      <legend {...stylex.props(styles.legend)}>{label}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          {...stylex.props(
            styles.option,
            option.value === value && styles.optionSelected,
            option.disabled === true && styles.optionDisabled,
          )}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            disabled={option.disabled}
            onChange={() => onChange(option.value)}
            {...stylex.props(styles.radio)}
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}

function Regions({
  regions,
  size,
  selected,
}: {
  regions: readonly VisualRegion[];
  size: Size;
  selected: number | null;
}) {
  return regions.map((region, index) => (
    <span
      key={index}
      aria-hidden="true"
      data-region=""
      {...stylex.props(
        styles.region,
        index === selected && styles.regionSelected,
        styles.regionBox(
          percent(region.x, size.width),
          percent(region.y, size.height),
          percent(region.width, size.width),
          percent(region.height, size.height),
        ),
      )}
    >
      <span {...stylex.props(styles.regionNumber)}>{index + 1}</span>
    </span>
  ));
}

function Caption({ side }: { side: Side }) {
  const capture = side.capture?.manifest ?? null;

  return (
    <span {...stylex.props(styles.caption)}>
      {capture?.label ?? 'No capture'}
      {capture === null ? null : (
        <>
          {' · '}
          <span
            title={describeRevision(capture.source.revision)}
            {...stylex.props(styles.mono)}
          >
            {shortSource(capture.source)}
          </span>
        </>
      )}
    </span>
  );
}

// Scroll containers that follow each other, so both versions stay on the same
// place at any zoom.
function useLinkedScroll() {
  const [linked] = useState(linkedScroll);

  return linked;
}

function linkedScroll() {
  const panes = new Set<HTMLDivElement>();
  // Panes whose next scroll event comes from follow, not the reader. Without
  // this, a pane that clamps the copied offset would copy it back.
  const driven = new WeakSet<HTMLDivElement>();

  return {
    register: (element: HTMLDivElement | null) => {
      if (element === null) {
        return;
      }

      panes.add(element);

      return () => {
        panes.delete(element);
      };
    },
    follow: (source: HTMLDivElement) => {
      if (driven.delete(source)) {
        return;
      }

      for (const pane of panes) {
        if (pane !== source) {
          const { scrollLeft, scrollTop } = pane;

          pane.scrollLeft = source.scrollLeft;
          pane.scrollTop = source.scrollTop;

          if (pane.scrollLeft !== scrollLeft || pane.scrollTop !== scrollTop) {
            driven.add(pane);
          }
        }
      }
    },
    all: () => [...panes],
  };
}

function conditionsOf(side: Side) {
  const conditions = side.capture?.manifest.conditions;

  return conditions?.kind === 'recorded' ? conditions.value : null;
}

function shortOf(side: Side): string {
  return side.capture === null
    ? 'unavailable'
    : `${side.capture.manifest.label} ${shortSource(side.capture.manifest.source)}`;
}

// The capture conditions both screenshots were taken under, one chip each.
// A value that differs between the sides names both.
function contextChips(
  before: Side,
  after: Side,
  sizes: { before: Size | null; after: Size | null },
): string[] {
  const base = conditionsOf(before);
  const candidate = conditionsOf(after);
  const pair = (
    name: string,
    read: (value: NonNullable<typeof base>) => string,
  ) => {
    const left = base === null ? `${name} unavailable` : read(base);
    const right = candidate === null ? `${name} unavailable` : read(candidate);

    return left === right ? left : `Before ${left} · After ${right}`;
  };

  const size = (value: Size | null) =>
    value === null ? null : `${value.width} × ${value.height} px`;
  const beforeSize = size(sizes.before);
  const afterSize = size(sizes.after);

  return [
    pair('browser', (value) => value.browser),
    pair(
      'viewport',
      (value) =>
        `viewport ${value.viewport.width} × ${value.viewport.height} at ${value.viewport.scale}×`,
    ),
    pair('color scheme', (value) => `${value.colorScheme} scheme`),
    beforeSize === afterSize
      ? `screenshot ${beforeSize ?? 'size unavailable'}`
      : `screenshots Before ${beforeSize ?? 'unavailable'} · After ${afterSize ?? 'unavailable'}`,
  ];
}

export function BeforeAfter({
  before,
  after,
  visual,
}: {
  before: Side;
  after: Side;
  visual: Visual | null;
}) {
  const resolve = use(EvidenceUrls);
  const changed = visual?.kind === 'changed' ? visual : null;
  const sameSize =
    before.screenshot !== null &&
    after.screenshot !== null &&
    visual !== null &&
    visual.kind !== 'size-differs' &&
    visual.kind !== 'unavailable';
  const [mode, setMode] = useState<Mode>('side');
  const changes = changed === null ? null : unionOf(changed.regions);
  // 'changes' fits the box around every changed region to the pane width,
  // between Fit and twice the screenshot's size, so a small change reads at
  // a glance; Fit width shows the whole capture.
  const [zoom, setZoom] = useState<number | 'fit' | 'changes'>(
    changes === null ? 'fit' : 'changes',
  );
  const [selected, setSelected] = useState<number | null>(null);
  const [showRegions, setShowRegions] = useState(true);
  const [divider, setDivider] = useState(50);
  const [onion, setOnion] = useState(50);
  const [loaded, setLoaded] = useState<{ before?: Size; after?: Size }>({});
  const [jump, setJump] = useState<{ box: Box; count: number } | null>(
    changes === null ? null : { box: changes, count: 0 },
  );
  const linked = useLinkedScroll();
  const regionsId = useId();

  const size: Size | null =
    visual !== null && 'width' in visual
      ? { width: visual.width, height: visual.height }
      : (loaded.after ?? loaded.before ?? null);
  const effectiveMode =
    !sameSize && (mode === 'slider' || mode === 'onion') ? 'side' : mode;

  const fitZoom = () => {
    const [pane] = linked.all();

    return pane === undefined || size === null
      ? 1
      : pane.clientWidth / size.width;
  };

  const shownZoom = () => {
    const frame = linked.all()[0]?.querySelector('[data-frame]');

    return frame instanceof HTMLElement && size !== null
      ? frame.offsetWidth / size.width
      : fitZoom();
  };

  const step = (direction: 1 | -1) => {
    const currentZoom = typeof zoom === 'number' ? zoom : shownZoom();
    const next =
      direction === 1
        ? zoomLevels.find((level) => level > currentZoom + 0.001)
        : zoomLevels.findLast((level) => level < currentZoom - 0.001);

    if (next !== undefined) {
      setZoom(next);
    }
  };

  const select = (index: number) => {
    const region = changed?.regions[index];
    const [pane] = linked.all();

    if (region === undefined) {
      return;
    }

    setSelected(index);
    setShowRegions(true);
    setJump((current) => ({ box: region, count: (current?.count ?? 0) + 1 }));

    if (pane !== undefined) {
      const fit = (pane.clientWidth * 0.6) / (region.width + regionPadding * 2);
      const level =
        zoomLevels.findLast((value) => value <= fit) ?? zoomLevels[0] ?? 1;

      setZoom(Math.max(level, Math.min(1, fitZoom())));
    }
  };

  // Centers the target after its zoom is laid out, and again once the images
  // load (their height is unknown before) or a new mode mounts new panes.
  useLayoutEffect(() => {
    const region = jump?.box;

    if (region === undefined || changed === null) {
      return;
    }

    for (const pane of linked.all()) {
      const frame = pane.querySelector('[data-frame]');
      const scale =
        frame instanceof HTMLElement ? frame.offsetWidth / changed.width : 1;

      pane.scrollLeft =
        (region.x + region.width / 2) * scale - pane.clientWidth / 2;
      pane.scrollTop =
        (region.y + region.height / 2) * scale - pane.clientHeight / 2;
    }
  }, [jump, changed, linked, loaded.before, loaded.after, effectiveMode]);

  // Each side keeps its own scale when the screenshots differ in size.
  const frameWidth = (side?: 'before' | 'after') => {
    const own = (side === undefined || sameSize ? null : loaded[side]) ?? size;

    if (zoom === 'changes' && changes !== null && own !== null) {
      // Fit the box's width to the pane and its height to 60vh, the
      // shortest pane height, whichever needs the smaller zoom.
      const byWidth = own.width / (changes.width + regionPadding * 2);
      const byHeight = own.width / (changes.height + regionPadding * 2);

      return `clamp(100%, min(calc(100% * ${byWidth.toFixed(4)}), calc(60vh * ${byHeight.toFixed(4)})), ${own.width * 2}px)`;
    }

    return typeof zoom !== 'number' || own === null
      ? '100%'
      : `${Math.round(own.width * zoom)}px`;
  };

  const overlay =
    changed !== null && showRegions && size !== null ? (
      <Regions regions={changed.regions} size={size} selected={selected} />
    ) : null;
  const image = (
    side: Side,
    label: 'Before' | 'After',
    layer?: { clip: string } | { opacity: number },
  ) =>
    side.screenshot === null ? null : (
      <img
        src={resolve(side.screenshot)}
        alt={`${label}: captured application`}
        draggable={false}
        onLoad={(event) => {
          const { naturalWidth, naturalHeight } = event.currentTarget;

          setLoaded((current) => ({
            ...current,
            [label === 'Before' ? 'before' : 'after']: {
              width: naturalWidth,
              height: naturalHeight,
            },
          }));
        }}
        {...stylex.props(
          styles.image,
          typeof zoom === 'number' && zoom >= 2 && styles.pixelated,
          layer !== undefined && styles.overlayImage,
          layer !== undefined && 'clip' in layer && styles.clip(layer.clip),
          layer !== undefined &&
            'opacity' in layer &&
            styles.fade(layer.opacity),
        )}
      />
    );

  const viewport = (label: string, children: ReactNode) => (
    <div {...stylex.props(changed !== null && styles.withTicks)}>
      {changed === null ? null : (
        <span aria-hidden="true" {...stylex.props(styles.ticks)}>
          {changed.regions.map((region, index) => (
            <span
              key={index}
              title={`Region ${index + 1}`}
              onClick={() => select(index)}
              {...stylex.props(
                styles.tick,
                index === selected && styles.tickSelected,
                styles.tickAt(
                  percent(region.y, changed.height),
                  percent(
                    Math.max(region.height, changed.height / 100),
                    changed.height,
                  ),
                ),
              )}
            />
          ))}
        </span>
      )}
      <div
        ref={linked.register}
        role="region"
        aria-label={`${label}. Scroll to move both versions together.`}
        tabIndex={0}
        onScroll={(event) => linked.follow(event.currentTarget)}
        {...stylex.props(styles.viewport, styles.focus)}
      >
        {children}
      </div>
    </div>
  );
  const frame = (children: ReactNode, side?: 'before' | 'after') => (
    <span
      data-frame=""
      {...stylex.props(styles.frame, styles.frameWidth(frameWidth(side)))}
    >
      {children}
    </span>
  );
  const missing = (label: string) => (
    <p {...stylex.props(styles.missing)}>
      {label} screenshot unavailable. See unresolved evidence.
    </p>
  );

  const modes: { value: Mode; label: string; disabled?: boolean }[] = [
    { value: 'side', label: 'Side by side' },
    ...(changed === null ? [] : [{ value: 'diff' as const, label: 'Diff' }]),
    { value: 'slider', label: 'Slider', disabled: !sameSize },
    { value: 'onion', label: 'Onion skin', disabled: !sameSize },
    { value: 'before', label: 'Before' },
    { value: 'after', label: 'After' },
  ];

  const sizes =
    visual !== null && 'width' in visual
      ? { before: size, after: size }
      : {
          before:
            visual?.kind === 'size-differs'
              ? visual.base
              : (loaded.before ?? null),
          after:
            visual?.kind === 'size-differs'
              ? visual.candidate
              : (loaded.after ?? null),
        };

  return (
    <div {...stylex.props(styles.root)}>
      <p {...stylex.props(styles.status)}>
        Before is {shortOf(before)}. After is {shortOf(after)}.
      </p>
      <ul aria-label="Capture context" {...stylex.props(styles.context)}>
        {contextChips(before, after, sizes).map((chip, index) => (
          <li key={index} {...stylex.props(styles.chip)}>
            {chip}
          </li>
        ))}
      </ul>
      <div {...stylex.props(styles.toolbar)}>
        <SegmentedControl
          label="Comparison view"
          value={effectiveMode}
          options={modes}
          onChange={setMode}
        />
        <div role="group" aria-label="Zoom" {...stylex.props(styles.group)}>
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => {
              if (zoom !== zoomLevels[0]) {
                step(-1);
              }
            }}
            aria-disabled={zoom === zoomLevels[0]}
            {...stylex.props(
              styles.button,
              styles.focus,
              zoom === zoomLevels[0] && styles.inactive,
            )}
          >
            <svg viewBox="0 0 12 12" width={12} height={12} aria-hidden="true">
              <path d="M2 6 H10" {...stylex.props(styles.icon)} />
            </svg>
          </button>
          <output aria-live="polite" {...stylex.props(styles.zoomValue)}>
            {zoomLabel(zoom)}
          </output>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => {
              if (zoom !== zoomLevels.at(-1)) {
                step(1);
              }
            }}
            aria-disabled={zoom === zoomLevels.at(-1)}
            {...stylex.props(
              styles.button,
              styles.focus,
              zoom === zoomLevels.at(-1) && styles.inactive,
            )}
          >
            <svg viewBox="0 0 12 12" width={12} height={12} aria-hidden="true">
              <path d="M2 6 H10 M6 2 V10" {...stylex.props(styles.icon)} />
            </svg>
          </button>
          {changes === null ? null : (
            <button
              type="button"
              aria-disabled={zoom === 'changes'}
              onClick={() => {
                if (zoom !== 'changes') {
                  setZoom('changes');
                  setSelected(null);
                  setJump((current) => ({
                    box: changes,
                    count: (current?.count ?? 0) + 1,
                  }));
                }
              }}
              {...stylex.props(
                styles.button,
                styles.focus,
                zoom === 'changes' && styles.inactive,
              )}
            >
              Fit changes
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (zoom !== 'fit') {
                setZoom('fit');
                setSelected(null);
              }
            }}
            aria-disabled={zoom === 'fit'}
            {...stylex.props(
              styles.button,
              styles.focus,
              zoom === 'fit' && styles.inactive,
            )}
          >
            Fit width
          </button>
        </div>
      </div>
      {!sameSize && before.screenshot !== null && after.screenshot !== null ? (
        <p {...stylex.props(styles.caption)}>
          Swipe, onion skin and flip need two screenshots of the same size.
        </p>
      ) : null}

      {effectiveMode === 'side' ? (
        <div {...stylex.props(styles.panes)}>
          {(
            [
              ['Before', before],
              ['After', after],
            ] as const
          ).map(([label, side]) => (
            <figure key={label} {...stylex.props(styles.paneBox)}>
              <div {...stylex.props(styles.paneHeader)}>
                <SubHeading xstyle={styles.paneTitle}>{label}</SubHeading>
                <Caption side={side} />
              </div>
              {side.screenshot === null
                ? missing(label)
                : viewport(
                    `${label} screenshot`,
                    frame(
                      <>
                        {image(side, label)}
                        {overlay}
                      </>,
                      label === 'Before' ? 'before' : 'after',
                    ),
                  )}
            </figure>
          ))}
        </div>
      ) : null}

      {effectiveMode === 'slider' ? (
        <div {...stylex.props(styles.paneBox)}>
          {viewport(
            'Before and After screenshots, divided',
            <>
              <div aria-hidden="true" {...stylex.props(styles.tags)}>
                <span {...stylex.props(styles.sideTag)}>Before</span>
                <span {...stylex.props(styles.sideTag)}>After</span>
              </div>
              {frame(
                <>
                  {image(after, 'After')}
                  {image(before, 'Before', { clip: `${100 - divider}%` })}
                  <span
                    aria-hidden="true"
                    {...stylex.props(
                      styles.divider,
                      styles.dividerAt(`${divider}%`),
                    )}
                  />
                  {overlay}
                </>,
              )}
            </>,
          )}
          <label {...stylex.props(styles.sliderRow)}>
            <span {...stylex.props(styles.sideWord)}>Before</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={divider}
              aria-label="Divider position"
              aria-valuetext={`${divider}% Before on the left, ${100 - divider}% After on the right`}
              onChange={(event) =>
                setDivider(Number(event.currentTarget.value))
              }
              {...stylex.props(styles.slider, styles.focus)}
            />
            <span {...stylex.props(styles.sideWord)}>After</span>
          </label>
        </div>
      ) : null}

      {effectiveMode === 'onion' ? (
        <div {...stylex.props(styles.paneBox)}>
          {viewport(
            'After screenshot over Before',
            <>
              <div aria-hidden="true" {...stylex.props(styles.tags)}>
                <span {...stylex.props(styles.sideTag)}>
                  After at {onion}% over Before
                </span>
              </div>
              {frame(
                <>
                  {image(before, 'Before')}
                  {image(after, 'After', { opacity: onion / 100 })}
                  {overlay}
                </>,
              )}
            </>,
          )}
          <label {...stylex.props(styles.sliderRow)}>
            <span {...stylex.props(styles.sideWord)}>Before</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={onion}
              aria-label="After opacity"
              aria-valuetext={`After at ${onion}% opacity over Before`}
              onChange={(event) => setOnion(Number(event.currentTarget.value))}
              {...stylex.props(styles.slider, styles.focus)}
            />
            <span {...stylex.props(styles.sideWord)}>After</span>
          </label>
        </div>
      ) : null}

      {effectiveMode === 'before' || effectiveMode === 'after' ? (
        <div {...stylex.props(styles.paneBox)}>
          <div {...stylex.props(styles.paneHeader)}>
            <SubHeading xstyle={styles.paneTitle}>
              {effectiveMode === 'before' ? 'Before' : 'After'}
            </SubHeading>
            <Caption side={effectiveMode === 'before' ? before : after} />
          </div>
          {(effectiveMode === 'before' ? before : after).screenshot === null
            ? missing(effectiveMode === 'before' ? 'Before' : 'After')
            : viewport(
                `${effectiveMode === 'before' ? 'Before' : 'After'} screenshot`,
                frame(
                  <>
                    {effectiveMode === 'before'
                      ? image(before, 'Before')
                      : image(after, 'After')}
                    {overlay}
                  </>,
                  effectiveMode,
                ),
              )}
        </div>
      ) : null}

      {effectiveMode === 'diff' && changed !== null ? (
        <div {...stylex.props(styles.paneBox)}>
          <p {...stylex.props(styles.caption)}>{diffLegend}</p>
          {viewport(
            'Pixel difference image',
            frame(
              <>
                <img
                  src={resolve(changed.diff.path)}
                  alt="Pixel difference between Before and After"
                  draggable={false}
                  {...stylex.props(styles.image)}
                />
                {overlay}
              </>,
            ),
          )}
        </div>
      ) : null}

      {changed === null ? null : (
        <section aria-labelledby={regionsId} {...stylex.props(styles.regions)}>
          <div {...stylex.props(styles.toolbar)}>
            <SubHeading id={regionsId} xstyle={styles.heading}>
              Changed regions
            </SubHeading>
            <div {...stylex.props(styles.group)}>
              <button
                type="button"
                onClick={() =>
                  select(
                    selected === null || selected === 0
                      ? changed.regions.length - 1
                      : selected - 1,
                  )
                }
                {...stylex.props(styles.button, styles.focus)}
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() =>
                  select(
                    selected === null || selected === changed.regions.length - 1
                      ? 0
                      : selected + 1,
                  )
                }
                {...stylex.props(styles.button, styles.focus)}
              >
                Next
              </button>
              <button
                type="button"
                aria-pressed={showRegions}
                onClick={() => setShowRegions((value) => !value)}
                {...stylex.props(styles.button, styles.focus)}
              >
                {showRegions ? 'Hide outlines' : 'Show outlines'}
              </button>
            </div>
          </div>
          <p aria-live="polite" {...stylex.props(styles.status)}>
            {selected === null
              ? `${changed.regions.length} listed. Select one to zoom both versions to it.`
              : `Region ${selected + 1} of ${changed.regions.length}.`}
          </p>
          <ol {...stylex.props(styles.regionList)}>
            {changed.regions.map((region, index) => (
              <li key={index}>
                <button
                  type="button"
                  aria-pressed={index === selected}
                  onClick={() => select(index)}
                  {...stylex.props(
                    styles.regionButton,
                    styles.focus,
                    index === selected && styles.regionButtonSelected,
                  )}
                >
                  <span {...stylex.props(styles.regionIndex)}>{index + 1}</span>
                  <span>{describeRegion(region)}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      <nav aria-label="Screenshot files" {...stylex.props(styles.links)}>
        {before.screenshot === null ? null : (
          <EvidenceLink href={before.screenshot}>
            Open Before screenshot
          </EvidenceLink>
        )}
        {after.screenshot === null ? null : (
          <EvidenceLink href={after.screenshot}>
            Open After screenshot
          </EvidenceLink>
        )}
        {changed === null ? null : (
          <EvidenceLink href={changed.diff.path}>
            Open pixel difference image
          </EvidenceLink>
        )}
      </nav>
    </div>
  );
}
