import * as stylex from '@stylexjs/stylex';
import {
  use,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useMemo,
} from 'react';
import { fonts, geometry, media } from './constants.stylex';
import { EvidenceUrls } from './evidence';
import type { Comparison } from '../comparison-model';
import {
  edgeId,
  exportedScene,
  sourceWindow,
  transitionMs,
  type Beat,
  type CodeLine,
  type Edge,
  type Entity,
  type EntityState,
  type Scene,
  type Tone,
} from './scene-model';
import { darkColors, darkEffects } from './themes';
import { colors } from './tokens.stylex';

const credit = {
  name: 'Kit Langton',
  href: 'https://x.com/kitlangton/status/2106623769146233112',
};

const transition = transitionMs;

type Box = { x: number; y: number; w: number; h: number };

type Layout = {
  kind: 'wide' | 'narrow';
  width: number;
  height: number;
  boxes: ReadonlyMap<string, Box>;
  page: Box;
  clock: Box;
  caption: Box;
  codeCaption: Box;
  footer: number;
  code: Box;
  callout: Box | null;
};

function column(entities: readonly Entity[]): Entity[] {
  return entities.filter(
    (entity) => entity.kind === 'request' || entity.kind === 'errors',
  );
}

function wideLayout(scene: Scene): Layout {
  const boxes = new Map<string, Box>();
  const side = column(scene.entities);
  const boxHeight = 56;
  const gap = 14;
  const total = side.length * boxHeight + (side.length - 1) * gap;
  const top = Math.max(150, 270 - total / 2);

  boxes.set('journey', { x: 56, y: 238, w: 224, h: 64 });
  boxes.set('check', { x: 356, y: 84, w: 248, h: 60 });

  for (const [index, entity] of side.entries()) {
    boxes.set(entity.id, {
      x: 648,
      y: top + index * (boxHeight + gap),
      w: 256,
      h: boxHeight,
    });
  }

  return {
    kind: 'wide',
    width: 960,
    height: 540,
    boxes,
    page: { x: 380, y: 200, w: 200, h: 136 },
    clock: { x: 56, y: 182, w: 188, h: 28 },
    caption: { x: 56, y: 432, w: 848, h: 66 },
    codeCaption: { x: 56, y: 428, w: 848, h: 66 },
    footer: 506,
    code: { x: 96, y: 84, w: 768, h: 304 },
    callout: { x: 56, y: 104, w: 286, h: 24 },
  };
}

function narrowLayout(scene: Scene): Layout {
  const boxes = new Map<string, Box>();
  const side = column(scene.entities);
  let y = 410;

  boxes.set('journey', { x: 20, y: 136, w: 320, h: 56 });

  for (const entity of side) {
    boxes.set(entity.id, { x: 36, y, w: 304, h: 52 });
    y += 64;
  }

  if (scene.check !== null) {
    boxes.set('check', { x: 20, y: y + 8, w: 320, h: 56 });
    y += 72;
  }

  return {
    kind: 'narrow',
    width: 360,
    height: y + 172,
    boxes,
    page: { x: 90, y: 222, w: 180, h: 124 },
    clock: { x: 20, y: 94, w: 200, h: 28 },
    caption: { x: 20, y: y + 16, w: 320, h: 104 },
    codeCaption: { x: 20, y: 430, w: 320, h: 104 },
    footer: y + 132,
    code: { x: 12, y: 96, w: 336, h: 300 },
    callout: null,
  };
}

type Point = { x: number; y: number };

type Curve = [Point, Point, Point, Point];

function center(box: Box): Point {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

function curveBetween(from: Box, to: Box, layout: Layout): Curve {
  const a = center(from);
  const b = center(to);

  if (layout.kind === 'narrow' && to.x <= from.x) {
    // Stacked boxes join along the left gutter so lines never cross a box.
    const start = { x: from.x, y: a.y };
    const end = { x: to.x, y: b.y };
    const gutter = Math.min(start.x, end.x) - 14;

    return [start, { x: gutter, y: a.y }, { x: gutter, y: b.y }, end];
  }

  if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) {
    const right = b.x > a.x;
    const start = { x: right ? from.x + from.w : from.x, y: a.y };
    const end = { x: right ? to.x : to.x + to.w, y: b.y };
    const middle = (start.x + end.x) / 2;

    return [start, { x: middle, y: start.y }, { x: middle, y: end.y }, end];
  }

  const down = b.y > a.y;
  const start = { x: a.x, y: down ? from.y + from.h : from.y };
  const end = { x: b.x, y: down ? to.y : to.y + to.h };
  const middle = (start.y + end.y) / 2;

  return [start, { x: start.x, y: middle }, { x: end.x, y: middle }, end];
}

function pointOn([p0, p1, p2, p3]: Curve, t: number): Point {
  const u = 1 - t;
  const at = (a: number, b: number, c: number, d: number) =>
    u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;

  return { x: at(p0.x, p1.x, p2.x, p3.x), y: at(p0.y, p1.y, p2.y, p3.y) };
}

function pathOf([p0, p1, p2, p3]: Curve): string {
  return `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`;
}

function seconds(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(2)} s`;
}

const phaseLabels = {
  base: 'before',
  candidate: 'after',
  source: 'the source',
} satisfies Record<Beat['phase'], string>;

function shortRevision(revision: string): string {
  const commit = /[0-9a-f]{7}/.exec(revision)?.[0];

  return revision.startsWith('worktree') && commit !== undefined
    ? `worktree on ${commit}`
    : (revision.split(' · ')[0] ?? revision);
}

function phaseText(scene: Scene, beat: Beat): string {
  return beat.phase === 'source'
    ? phaseLabels.source
    : `${phaseLabels[beat.phase]} · ${beat.phase} ${shortRevision(scene.revisions[beat.phase])}`;
}

// The after side's result, where the scene opens.
function restingBeat(scene: Scene): number {
  const index = scene.beats.findLastIndex((beat) => beat.phase === 'candidate');

  return index === -1 ? 0 : index;
}

const boxTones = {
  quiet: 'boxQuiet',
  active: 'boxActive',
  checked: 'boxChecked',
  regression: 'boxRegression',
  unknown: 'boxUnknown',
} as const satisfies Record<Tone, string>;

const lineTones = {
  quiet: 'lineQuiet',
  active: 'lineActive',
  checked: 'lineChecked',
  regression: 'lineRegression',
  unknown: 'lineUnknown',
} as const satisfies Record<Tone, string>;

const edgeKinds = {
  drives: ['drives', 'drivesPulse'],
  requested: ['requested', 'requestedPulse'],
  threw: ['threw', 'threwPulse'],
  checked: ['checkedBy', 'checkedByPulse'],
} as const satisfies Record<Edge['kind'], readonly [string, string]>;

// Every text sits on its own opaque background, so axe-core can measure its
// contrast; text over the SVG layer reads to it as text over an image.
function Placed({
  box,
  xstyle,
  children,
}: {
  box: Box;
  xstyle?: stylex.StyleXStyles;
  children?: ReactNode;
}) {
  return (
    <div
      {...stylex.props(
        styles.placed,
        styles.at(box.x, box.y, box.w, box.h),
        xstyle,
      )}
    >
      {children}
    </div>
  );
}

function EntityBox({
  entity,
  box,
  state,
  previous,
  progress,
}: {
  entity: Entity;
  box: Box;
  state: EntityState;
  previous: EntityState | undefined;
  progress: number;
}) {
  const changed = previous?.line !== state.line || previous.tone !== state.tone;

  return (
    <Placed box={box} xstyle={[styles.box, styles[boxTones[state.tone]]]}>
      <span
        {...stylex.props(
          styles.boxTitle,
          state.tone === 'regression' && styles.lineRegression,
        )}
      >
        {entity.title}
      </span>
      <span
        {...stylex.props(
          styles.stateLine,
          styles[lineTones[state.tone]],
          styles.fade(changed ? progress : 1),
        )}
      >
        {state.line}
      </span>
    </Placed>
  );
}

function PageImage({
  layout,
  screenshot,
  fade,
  pattern,
  clip,
}: {
  layout: Layout;
  screenshot: string | null;
  fade: number;
  pattern: string;
  clip: string;
}) {
  const resolve = use(EvidenceUrls);
  const { page } = layout;

  return (
    <g>
      <defs>
        <pattern
          id={pattern}
          width={8}
          height={8}
          patternUnits="userSpaceOnUse"
        >
          <rect width={1.5} height={1.5} {...stylex.props(styles.dot)} />
        </pattern>
        <clipPath id={clip}>
          <rect x={page.x} y={page.y} width={page.w} height={page.h} rx={8} />
        </clipPath>
      </defs>
      <rect
        x={page.x}
        y={page.y}
        width={page.w}
        height={page.h}
        rx={8}
        fill={`url(#${pattern})`}
      />
      {screenshot === null ? null : (
        <image
          href={resolve(screenshot)}
          x={page.x}
          y={page.y}
          width={page.w}
          height={page.h}
          preserveAspectRatio="xMidYMin slice"
          clipPath={`url(#${clip})`}
          opacity={fade}
        />
      )}
      <rect
        x={page.x}
        y={page.y}
        width={page.w}
        height={page.h}
        rx={8}
        fill="none"
        strokeWidth={1}
        {...stylex.props(styles.frame)}
      />
    </g>
  );
}

function EdgeLine({
  edge,
  curve,
  lit,
  progress,
  motion,
}: {
  edge: Edge;
  curve: Curve;
  lit: boolean;
  progress: number;
  motion: boolean;
}) {
  const pulse = pointOn(curve, progress);
  const [line, dot] = edgeKinds[edge.kind];

  return (
    <g>
      <path
        d={pathOf(curve)}
        fill="none"
        strokeWidth={lit ? 1.75 : 1.25}
        opacity={lit ? 1 : 0.7}
        {...stylex.props(styles[line])}
      />
      {lit && motion && progress < 1 ? (
        <circle
          cx={pulse.x}
          cy={pulse.y}
          r={3.5}
          {...stylex.props(styles[dot])}
        />
      ) : null}
    </g>
  );
}

type SourceText =
  | { kind: 'loading' }
  | { kind: 'ready'; lines: readonly CodeLine[] }
  | { kind: 'unavailable' };

function useSource(scene: Scene): SourceText {
  const resolve = use(EvidenceUrls);
  const source = scene.source;
  const [text, setText] = useState<SourceText>({ kind: 'loading' });

  useEffect(() => {
    if (source === null) {
      return;
    }

    let current = true;
    const read = async (path: string | null) => {
      if (path === null) {
        return null;
      }

      const response = await fetch(resolve(path));

      return response.ok ? response.text() : null;
    };

    Promise.all([read(source.base), read(source.candidate)])
      .then(([base, candidate]) => {
        const lines = sourceWindow({ anchor: source.anchor, base, candidate });

        if (current) {
          setText(
            lines === null ? { kind: 'unavailable' } : { kind: 'ready', lines },
          );
        }
      })
      .catch(() => {
        if (current) {
          setText({ kind: 'unavailable' });
        }
      });

    return () => {
      current = false;
    };
  }, [resolve, source]);

  return text;
}

// Drawn as generated content: axe-core cannot judge the contrast of a lone
// sign, and the band and strikethrough already carry the change.
function signStyle(change: CodeLine['change']) {
  switch (change) {
    case 'added':
      return styles.signAdded;
    case 'removed':
      return styles.signRemoved;
    case 'same':
      return null;
  }
}

function CodeFrame({
  scene,
  layout,
  source,
  fade,
}: {
  scene: Scene;
  layout: Layout;
  source: SourceText;
  fade: number;
}) {
  const wide = layout.kind === 'wide';
  // Red marks only a stack frame of a failing check; other anchors are
  // associations, drawn neutral.
  const failing =
    (scene.check?.verdict === 'regression' ||
      scene.check?.verdict === 'failed') &&
    scene.source?.anchor.basis === 'stack-frame';

  return (
    <Placed box={layout.code} xstyle={[styles.panel, styles.fade(fade)]}>
      <div {...stylex.props(styles.panelHeader)}>
        <span aria-hidden="true" {...stylex.props(styles.panelDot)} />
        {scene.source?.place}
      </div>
      {source.kind === 'ready' ? (
        <div {...stylex.props(styles.codeLines, !wide && styles.codeNarrow)}>
          {source.lines.map((line, index) => (
            <div
              key={index}
              {...stylex.props(
                styles.codeLine,
                line.change !== 'same' && styles.changeBand,
                line.anchor && (failing ? styles.anchorBand : styles.anchor),
              )}
            >
              <span {...stylex.props(!line.anchor && styles.lineQuiet)}>
                {line.number ?? ''}
              </span>
              <span
                aria-hidden="true"
                {...stylex.props(
                  !line.anchor && styles.lineQuiet,
                  signStyle(line.change),
                )}
              />
              <span
                {...stylex.props(
                  styles.codeText,
                  line.change === 'removed' &&
                    (line.anchor ? styles.struck : styles.removed),
                )}
              >
                {line.text}
                {line.anchor && wide ? (
                  <span
                    {...stylex.props(
                      failing ? styles.lineRegression : styles.clockValue,
                    )}
                  >
                    {`  ◂ ${scene.source?.words ?? ''}`}
                  </span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p {...stylex.props(styles.stateLine, styles.lineQuiet, styles.pad)}>
          {source.kind === 'loading'
            ? 'Reading the source snapshot'
            : 'The bundle holds no snapshot of this line'}
        </p>
      )}
      <p {...stylex.props(styles.small, styles.below)}>
        <span {...stylex.props(styles.onCanvas)}>
          {wide
            ? 'condensed for display · common indentation removed'
            : 'condensed for display'}
        </span>
      </p>
    </Placed>
  );
}

function Emphasized({
  text,
  emphasis,
}: {
  text: string;
  emphasis: Beat['emphasis'];
}) {
  const at = emphasis === null ? -1 : text.indexOf(emphasis.text);

  if (emphasis === null || at === -1) {
    return text;
  }

  return (
    <>
      {text.slice(0, at)}
      <span {...stylex.props(styles[lineTones[emphasis.tone]])}>
        {emphasis.text}
      </span>
      {text.slice(at + emphasis.text.length)}
    </>
  );
}

function SceneStage({
  scene,
  layout,
  index,
  progress,
  motion,
  source,
  scale,
}: {
  scene: Scene;
  layout: Layout;
  index: number;
  progress: number;
  motion: boolean;
  source: SourceText;
  scale: number;
}) {
  const ids = useId();
  const beat = scene.beats[index];
  const previous = index === 0 ? undefined : scene.beats[index - 1];

  if (beat === undefined) {
    return null;
  }

  const fresh = previous === undefined || previous.phase !== beat.phase;
  const clock = beat.clock;
  const fromElapsed =
    fresh || previous.clock === null || clock === null
      ? 0
      : previous.clock.elapsed;
  const shownElapsed =
    clock === null ? 0 : fromElapsed + (clock.elapsed - fromElapsed) * progress;
  const chip = phaseText(scene, beat);
  const sourcePhase = beat.phase === 'source';
  const wide = layout.kind === 'wide';
  const check = scene.check;
  const checkBox = layout.boxes.get('check');
  const page = beat.states.get('page');
  const callout =
    layout.callout === null || check?.measure === undefined
      ? null
      : layout.callout;

  return (
    <div
      {...stylex.props(
        styles.scaled(layout.width * scale, layout.height * scale),
      )}
    >
      <div
        role="img"
        aria-label={`${scene.title}, ${chip}. ${beat.caption}`}
        data-scene-ready={
          source.kind === 'loading' && scene.source !== null ? undefined : ''
        }
        {...stylex.props(
          styles.stage,
          styles.stageSize(layout.width, layout.height, scale),
        )}
      >
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width={layout.width}
          height={layout.height}
          {...stylex.props(styles.layer)}
        >
          {sourcePhase ? null : (
            <>
              {scene.edges.map((edge) => {
                const from =
                  edge.from === 'page'
                    ? layout.page
                    : layout.boxes.get(edge.from);
                const to =
                  edge.to === 'page' ? layout.page : layout.boxes.get(edge.to);

                return from === undefined || to === undefined ? null : (
                  <EdgeLine
                    key={edgeId(edge)}
                    edge={edge}
                    curve={curveBetween(from, to, layout)}
                    lit={beat.lit.includes(edgeId(edge))}
                    progress={progress}
                    motion={motion}
                  />
                );
              })}
              <PageImage
                layout={layout}
                screenshot={beat.screenshot}
                fade={previous?.screenshot === beat.screenshot ? 1 : progress}
                pattern={`${ids}-dots`}
                clip={`${ids}-clip`}
              />
              {callout === null || checkBox === undefined ? null : (
                <line
                  x1={callout.x + callout.w + 4}
                  x2={checkBox.x}
                  y1={callout.y + callout.h / 2}
                  y2={checkBox.y + checkBox.h / 2}
                  strokeWidth={1}
                  {...stylex.props(styles.rule)}
                />
              )}
            </>
          )}
        </svg>
        <Placed
          box={{
            x: wide ? 56 : 20,
            y: wide ? 36 : 20,
            w: wide ? 560 : 320,
            h: 26,
          }}
          xstyle={styles.title}
        >
          <span {...stylex.props(styles.onCanvas)}>{scene.title}</span>
        </Placed>
        <Placed
          box={
            wide
              ? { x: 600, y: 36, w: 304, h: 26 }
              : { x: 20, y: 52, w: 320, h: 26 }
          }
          xstyle={[styles.chipRow, wide && styles.chipRight]}
        >
          <span {...stylex.props(styles.chip)}>
            <span aria-hidden="true" {...stylex.props(styles.panelDot)} />
            {chip}
          </span>
        </Placed>
        {sourcePhase ? (
          <CodeFrame
            scene={scene}
            layout={layout}
            source={source}
            fade={fresh ? progress : 1}
          />
        ) : (
          <>
            {clock === null ? null : (
              <Placed box={layout.clock} xstyle={[styles.chip, styles.clock]}>
                <span {...stylex.props(styles.lineQuiet)}>
                  step {clock.step}/{clock.steps}
                </span>
                <span {...stylex.props(styles.clockValue)}>
                  {seconds(shownElapsed)}
                </span>
              </Placed>
            )}
            {page === undefined ? null : (
              <Placed
                box={{
                  x: layout.page.x - 60,
                  y: layout.page.y + layout.page.h + 8,
                  w: layout.page.w + 120,
                  h: 40,
                }}
                xstyle={styles.pageLabel}
              >
                <span {...stylex.props(styles.onCanvas, styles.boxTitle)}>
                  page
                </span>
                <span
                  {...stylex.props(
                    styles.onCanvas,
                    styles.stateLine,
                    styles[lineTones[page.tone]],
                  )}
                >
                  {beat.screenshot === null
                    ? page.line
                    : `◼ screenshot · ${page.line}`}
                </span>
              </Placed>
            )}
            {scene.entities.map((entity) => {
              const box = layout.boxes.get(entity.id);
              const state = beat.states.get(entity.id);

              return box === undefined || state === undefined ? null : (
                <EntityBox
                  key={entity.id}
                  entity={entity}
                  box={box}
                  state={state}
                  previous={fresh ? undefined : previous.states.get(entity.id)}
                  progress={progress}
                />
              );
            })}
            {callout === null || check?.measure === undefined ? null : (
              <Placed box={callout} xstyle={styles.callout}>
                <span {...stylex.props(styles.onCanvas, styles.small)}>
                  <span {...stylex.props(styles.clockValue)}>
                    {check.measure.label}
                  </span>{' '}
                  · what the check measures
                </span>
              </Placed>
            )}
          </>
        )}
        <Placed
          box={sourcePhase ? layout.codeCaption : layout.caption}
          xstyle={[
            styles.caption,
            !wide && styles.captionNarrow,
            styles.fade(progress),
          ]}
        >
          <span {...stylex.props(styles.onCanvas)}>
            <Emphasized text={beat.caption} emphasis={beat.emphasis} />
          </span>
        </Placed>
        <Placed
          box={{
            x: wide ? 56 : 20,
            y: layout.footer,
            w: wide ? 848 : 320,
            h: wide ? 18 : 36,
          }}
          xstyle={[styles.footer, !wide && styles.footerNarrow]}
        >
          <span {...stylex.props(styles.onCanvas)}>
            {wide
              ? 'drawn from recorded evidence · not a screen recording'
              : 'drawn from evidence · not a recording'}
          </span>
          <span {...stylex.props(styles.onCanvas)}>after {credit.name}</span>
        </Placed>
      </div>
    </div>
  );
}

export const sceneFrameHash = '#scene-frame=';

function frameFromHash(hash: string): { beat: number; progress: number } {
  const [beat = '0', progress = '1'] = hash
    .slice(sceneFrameHash.length)
    .split('/');
  const index = Number.parseInt(beat, 10);
  const amount = Number.parseFloat(progress);

  return {
    beat: Number.isNaN(index) ? 0 : index,
    progress: Number.isNaN(amount) ? 1 : Math.min(1, Math.max(0, amount)),
  };
}

function subscribeHash(listener: () => void) {
  addEventListener('hashchange', listener);

  return () => removeEventListener('hashchange', listener);
}

// One still of the exported scene, chosen by the URL hash, in the dark theme
// at its own size. The export step steps the hash and screenshots each still.
export function SceneFrame({ result }: { result: Comparison }) {
  const exported = useMemo(() => exportedScene(result), [result]);
  const hash = useSyncExternalStore(subscribeHash, () => location.hash);

  if (exported === null) {
    return <p data-scene-frame="none">No scene to export.</p>;
  }

  return <FrameStill scene={exported.scene} hash={hash} />;
}

function FrameStill({ scene, hash }: { scene: Scene; hash: string }) {
  const source = useSource(scene);
  const { beat, progress } = frameFromHash(hash);

  return (
    <div
      data-scene-frame={`${beat}/${progress}`}
      {...stylex.props(darkColors, darkEffects, styles.frameRoot)}
    >
      <SceneStage
        scene={scene}
        layout={wideLayout(scene)}
        index={beat}
        progress={progress}
        motion
        source={source}
        scale={1}
      />
    </div>
  );
}

const reducedQuery = '(prefers-reduced-motion: reduce)';

function subscribeReduced(listener: () => void) {
  const query = matchMedia(reducedQuery);

  query.addEventListener('change', listener);

  return () => query.removeEventListener('change', listener);
}

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduced,
    () => matchMedia(reducedQuery).matches,
    () => true,
  );
}

const narrowBelow = 840;

const narrowMax = 520;

function useWidth(target: RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const element = target.current;

    if (element === null) {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) {
        setWidth(entry.contentRect.width);
      }
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, [target]);

  return width;
}

type Playhead = { index: number; time: number };

export function SceneView({ scene, level }: { scene: Scene; level: 2 | 3 }) {
  const reduced = useReducedMotion();
  const titleId = `${useId()}-scene`;
  const figure = useRef<HTMLDivElement>(null);
  const width = useWidth(figure);
  const rest = restingBeat(scene);
  const [head, setHead] = useState<Playhead>({
    index: rest,
    time: transition,
  });
  const [playing, setPlaying] = useState(false);
  const [resting, setResting] = useState(true);
  const [announce, setAnnounce] = useState('');
  const source = useSource(scene);
  const last = scene.beats.length - 1;
  const beat = scene.beats[head.index];
  const animating = !reduced && head.time < transition;
  const running = playing || animating;
  const Heading = level === 2 ? 'h2' : 'h3';

  useEffect(() => {
    const element = figure.current;

    if (element === null) {
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting !== true) {
        setPlaying(false);
      }
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!running) {
      return;
    }

    let frame = 0;
    let before = performance.now();
    const tick = (now: number) => {
      const step = now - before;

      before = now;
      setHead((current) => {
        const hold = scene.beats[current.index]?.hold ?? transition;
        const time = current.time + step;

        if (!playing) {
          return { ...current, time: Math.min(time, transition) };
        }

        if (time < hold) {
          return { ...current, time };
        }

        return current.index < last
          ? { index: current.index + 1, time: 0 }
          : { ...current, time: hold };
      });
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frame);
  }, [running, playing, scene.beats, last]);

  useEffect(() => {
    if (
      playing &&
      head.index === last &&
      head.time >= (scene.beats[last]?.hold ?? 0)
    ) {
      setPlaying(false);
    }
  }, [playing, head, last, scene.beats]);

  if (beat === undefined) {
    return null;
  }

  const go = (index: number) => {
    const target = Math.min(Math.max(index, 0), last);

    if (target === head.index && !playing) {
      return;
    }

    setPlaying(false);
    setResting(false);
    setHead({ index: target, time: reduced ? transition : 0 });
    setAnnounce(scene.beats[target]?.caption ?? '');
  };

  const playFromStart = () => {
    setResting(false);
    setAnnounce('');
    setHead({ index: 0, time: reduced ? transition : 0 });
    setPlaying(true);
  };

  const toggle = () => {
    if (playing) {
      setPlaying(false);

      return;
    }

    if (resting || head.index === last) {
      playFromStart();

      return;
    }

    setAnnounce('');
    setPlaying(true);
  };

  const keys = (event: KeyboardEvent) => {
    const actions: Record<string, () => void> = {
      ' ': toggle,
      k: toggle,
      ArrowLeft: () => go(head.index - 1),
      ArrowRight: () => go(head.index + 1),
      Home: () => go(0),
      End: () => go(last),
    };
    const action = actions[event.key];

    if (action !== undefined && event.target === event.currentTarget) {
      event.preventDefault();
      action();
    }
  };

  const narrow = width !== null && width < narrowBelow;
  const layout = narrow ? narrowLayout(scene) : wideLayout(scene);
  // The figure's 1px border sits inside the measured width.
  const shown =
    (narrow ? Math.min(width, narrowMax) : (width ?? layout.width + 2)) - 2;
  const progress = reduced ? 1 : Math.min(1, head.time / transition);

  return (
    <section aria-labelledby={titleId} {...stylex.props(styles.section)}>
      <Heading id={titleId} {...stylex.props(styles.heading)}>
        Before and after
      </Heading>
      <p {...stylex.props(styles.text)}>
        Each box shows a value the run recorded. The scene opens on the after
        side's result; Play runs it from the start. The clock shows recorded
        time, and playback holds each step so it can be read.
      </p>
      <div ref={figure} {...stylex.props(styles.measure)}>
        <div
          tabIndex={0}
          role="group"
          aria-roledescription="scene"
          aria-label={`${scene.title}: space plays or pauses, arrow keys step`}
          onKeyDown={keys}
          {...stylex.props(
            styles.figure,
            narrow && styles.figureWidth(Math.min(width, narrowMax)),
          )}
        >
          <SceneStage
            scene={scene}
            layout={layout}
            index={head.index}
            progress={progress}
            motion={!reduced}
            source={source}
            scale={shown / layout.width}
          />
        </div>
      </div>
      <div {...stylex.props(styles.controls)}>
        <button
          type="button"
          onClick={playFromStart}
          {...stylex.props(styles.control)}
        >
          Restart
        </button>
        <button
          type="button"
          aria-label="Previous step"
          aria-disabled={head.index === 0}
          onClick={() => go(head.index - 1)}
          {...stylex.props(styles.control, head.index === 0 && styles.inactive)}
        >
          ◂ Previous
        </button>
        <button
          type="button"
          onClick={toggle}
          {...stylex.props(styles.control, styles.primary)}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          aria-label="Next step"
          aria-disabled={head.index === last}
          onClick={() => go(head.index + 1)}
          {...stylex.props(
            styles.control,
            head.index === last && styles.inactive,
          )}
        >
          Next ▸
        </button>
        <span {...stylex.props(styles.position)}>
          {head.index + 1} of {scene.beats.length} · {phaseText(scene, beat)}
        </span>
      </div>
      <p aria-live="polite" {...stylex.props(styles.srOnly)}>
        {announce}
      </p>
      <details {...stylex.props(styles.transcript)}>
        <summary {...stylex.props(styles.summary)}>The scene as text</summary>
        <ol {...stylex.props(styles.list)}>
          {scene.beats.map((item, index) => (
            <li
              key={index}
              aria-current={index === head.index ? 'step' : undefined}
            >
              <button
                type="button"
                onClick={() => go(index)}
                {...stylex.props(
                  styles.beatButton,
                  index === head.index && styles.current,
                )}
              >
                <span {...stylex.props(styles.beatPhase)}>
                  {phaseText(scene, item)}
                </span>
                {item.caption}
              </button>
            </li>
          ))}
        </ol>
      </details>
      <p {...stylex.props(styles.credit)}>
        Layout after{' '}
        <a href={credit.href} {...stylex.props(styles.link)}>
          {credit.name}&apos;s PR explainers
        </a>
        .
      </p>
    </section>
  );
}

const styles = stylex.create({
  section: { display: 'grid', gap: 12, minWidth: 0 },
  frameRoot: { height: 540, overflow: 'hidden', width: 960 },
  heading: {
    fontSize: '1.25rem',
    fontWeight: 500,
    letterSpacing: '-0.01em',
    lineHeight: 1.35,
    margin: 0,
  },
  text: {
    color: colors.textSecondary,
    fontSize: '0.875rem',
    lineHeight: 1.5,
    margin: 0,
    maxWidth: '68ch',
  },
  figure: {
    borderColor: colors.border,
    borderRadius: geometry.radius,
    borderStyle: 'solid',
    borderWidth: 1,
    overflow: 'hidden',
    outlineColor: {
      default: 'transparent',
      ':focus-visible': colors.focus,
      [media.forcedColors]: 'Highlight',
    },
    outlineOffset: 3,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
  },
  figureWidth: (width: number) => ({ marginInline: 'auto', width }),
  measure: { minWidth: 0 },
  scaled: (width: number, height: number) => ({
    height,
    overflow: 'hidden',
    width,
  }),
  stage: {
    backgroundColor: colors.canvas,
    color: colors.text,
    fontFamily: fonts.mono,
    position: 'relative',
    transformOrigin: '0 0',
  },
  stageSize: (width: number, height: number, scale: number) => ({
    height,
    transform: `scale(${scale})`,
    width,
  }),
  layer: { left: 0, position: 'absolute', top: 0 },
  placed: { boxSizing: 'border-box', position: 'absolute' },
  at: (x: number, y: number, width: number, height: number) => ({
    height,
    left: x,
    top: y,
    width,
  }),
  fade: (opacity: number) => ({ opacity }),
  title: {
    fontSize: 16,
    lineHeight: '26px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  chipRow: { alignItems: 'center', display: 'flex' },
  chipRight: { justifyContent: 'flex-end' },
  chip: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 9999,
    borderStyle: 'solid',
    borderWidth: 1,
    color: colors.textSecondary,
    display: 'inline-flex',
    fontSize: 12,
    gap: 8,
    height: 26,
    paddingInline: 12,
    whiteSpace: 'nowrap',
  },
  clock: { gap: 12, height: 28 },
  panelDot: {
    backgroundColor: colors.textMuted,
    borderRadius: 9999,
    display: 'inline-block',
    flexShrink: 0,
    height: 7,
    width: 7,
  },
  small: { color: colors.textMuted, fontSize: 12 },
  clockValue: { color: colors.text },
  onCanvas: { backgroundColor: colors.canvas },
  box: {
    borderRadius: 8,
    borderStyle: 'solid',
    borderWidth: 1,
    display: 'grid',
    gap: 4,
    paddingInline: 14,
    placeContent: 'center stretch',
  },
  boxQuiet: {
    backgroundColor: colors.surface,
    borderColor: colors.borderControl,
  },
  boxActive: { backgroundColor: colors.surfaceMuted, borderColor: colors.text },
  boxChecked: {
    backgroundColor: colors.checkedFill,
    borderColor: colors.checked,
  },
  boxRegression: {
    backgroundColor: colors.regressionFill,
    borderColor: colors.regression,
    borderWidth: 1.5,
  },
  boxUnknown: {
    backgroundColor: colors.unknownFill,
    borderColor: colors.unknown,
  },
  boxTitle: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 1.3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  stateLine: {
    fontSize: 12,
    lineHeight: 1.3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  lineQuiet: { color: colors.textMuted },
  lineActive: { color: colors.textSecondary },
  lineChecked: { color: colors.checked },
  lineRegression: { color: colors.regression },
  lineUnknown: { color: colors.unknown },
  pageLabel: {
    alignItems: 'center',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  callout: {
    alignItems: 'center',
    display: 'flex',
    justifyContent: 'flex-end',
    whiteSpace: 'nowrap',
  },
  caption: { fontSize: 15, lineHeight: 1.5 },
  captionNarrow: { fontSize: 13 },
  footer: {
    color: colors.textMuted,
    display: 'flex',
    fontSize: 11,
    justifyContent: 'space-between',
  },
  footerNarrow: { flexDirection: 'column', gap: 4 },
  dot: { fill: colors.borderControl },
  frame: { stroke: colors.borderControl },
  rule: { stroke: colors.border },
  drives: { stroke: colors.linkImports },
  requested: { stroke: colors.linkRequested, strokeDasharray: '2 4' },
  threw: { stroke: colors.linkThrewAt, strokeDasharray: '9 3 2 3' },
  checkedBy: { stroke: colors.linkCheckedBy, strokeDasharray: '14 4' },
  drivesPulse: { fill: colors.linkImports },
  requestedPulse: { fill: colors.linkRequested },
  threwPulse: { fill: colors.linkThrewAt },
  checkedByPulse: { fill: colors.linkCheckedBy },
  panel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderStyle: 'solid',
    borderWidth: 1,
  },
  panelHeader: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomStyle: 'solid',
    borderBottomWidth: 1,
    color: colors.textMuted,
    display: 'flex',
    fontSize: 12,
    gap: 10,
    height: 40,
    paddingInline: 16,
  },
  codeLines: { display: 'grid', fontSize: 13, paddingBlock: 12 },
  codeNarrow: { fontSize: 11 },
  codeLine: {
    alignItems: 'center',
    display: 'grid',
    gridTemplateColumns: '3ch 2ch 1fr',
    gap: 8,
    lineHeight: 1.85,
    paddingInlineStart: 12,
  },
  codeText: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'pre',
  },
  removed: { color: colors.textMuted, textDecoration: 'line-through' },
  struck: { textDecoration: 'line-through' },
  signAdded: { '::before': { content: '"+"' } },
  signRemoved: { '::before': { content: '"−"' } },
  changeBand: { backgroundColor: colors.surfaceMuted },
  anchor: {
    boxShadow: `inset 3px 0 0 ${colors.text}`,
  },
  anchorBand: {
    backgroundColor: colors.regressionFill,
    boxShadow: `inset 3px 0 0 ${colors.regression}`,
  },
  pad: { margin: 0, padding: 24 },
  below: { left: 0, margin: 0, position: 'absolute', top: 'calc(100% + 10px)' },
  controls: {
    alignItems: 'center',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  control: {
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
    paddingInline: 14,
  },
  primary: { minWidth: 84 },
  inactive: { cursor: 'default', opacity: 0.5 },
  position: {
    color: colors.textMuted,
    fontFamily: fonts.mono,
    fontSize: '0.75rem',
    fontVariantNumeric: 'tabular-nums',
  },
  srOnly: {
    blockSize: 1,
    clipPath: 'inset(50%)',
    inlineSize: 1,
    overflow: 'hidden',
    position: 'absolute',
    whiteSpace: 'nowrap',
  },
  transcript: { color: colors.textSecondary, fontSize: '0.875rem' },
  summary: {
    alignContent: 'center',
    cursor: 'pointer',
    minHeight: geometry.target,
  },
  list: { display: 'grid', gap: 4, margin: 0, paddingInlineStart: 20 },
  beatButton: {
    backgroundColor: 'transparent',
    borderRadius: 6,
    borderWidth: 0,
    color: colors.textSecondary,
    cursor: 'pointer',
    display: 'grid',
    font: 'inherit',
    gap: 2,
    outlineColor: {
      default: 'transparent',
      ':focus-visible': colors.focus,
      [media.forcedColors]: 'Highlight',
    },
    outlineOffset: 2,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
    paddingBlock: 6,
    paddingInline: 8,
    textAlign: 'start',
  },
  current: { backgroundColor: colors.surfaceMuted, color: colors.text },
  beatPhase: {
    color: colors.textMuted,
    fontFamily: fonts.mono,
    fontSize: '0.75rem',
  },
  credit: { color: colors.textMuted, fontSize: '0.75rem', margin: 0 },
  link: { color: colors.text },
});
