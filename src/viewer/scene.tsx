import * as stylex from '@stylexjs/stylex';
import {
  use,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { fonts, geometry, media } from './constants.stylex';
import { EvidenceUrls } from './evidence';
import {
  edgeId,
  sourceWindow,
  type Beat,
  type CodeLine,
  type Edge,
  type Entity,
  type EntityState,
  type Scene,
  type Tone,
} from './scene-model';
import { colors } from './tokens.stylex';

// The scene's grammar, boxes with live state lines, a clock, edges that light
// when they carry an action, a typed caption and a closing code frame, follows
// Kit Langton's motion-graphic PR explainers.
export const credit = {
  name: 'Kit Langton',
  href: 'https://x.com/kitlangton/status/2106623770492588224',
};

const transition = 520;

// Geist Mono advances 0.6 em per character.
const advance = 0.6;

type Box = { x: number; y: number; w: number; h: number };

type Layout = {
  kind: 'wide' | 'narrow';
  width: number;
  height: number;
  boxes: ReadonlyMap<string, Box>;
  page: Box;
  clock: { x: number; y: number };
  caption: { x: number; y: number; chars: number; size: number };
  // The caption under the code frame.
  sourceCaption: number;
  footer: number;
  code: Box;
  callout: { x: number; y: number; anchor: 'start' | 'end' } | null;
};

function fit(text: string, chars: number): string {
  return text.length <= chars
    ? text
    : `${text.slice(0, Math.max(1, chars - 1))}…`;
}

function wrap(text: string, chars: number, rows: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current === '' ? word : `${current} ${word}`;

    if (next.length <= chars || current === '') {
      current = next;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current !== '') {
    lines.push(current);
  }

  if (lines.length <= rows) {
    return lines.map((line) => fit(line, chars));
  }

  return [
    ...lines.slice(0, rows - 1),
    fit(lines.slice(rows - 1).join(' '), chars),
  ];
}

function column(entities: readonly Entity[]): Entity[] {
  return entities.filter(
    (entity) => entity.kind === 'request' || entity.kind === 'errors',
  );
}

export function wideLayout(scene: Scene): Layout {
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
    clock: { x: 56, y: 182 },
    caption: { x: 56, y: 452, chars: 92, size: 15 },
    sourceCaption: 452,
    footer: 516,
    code: { x: 96, y: 84, w: 768, h: 304 },
    callout: { x: 342, y: 118, anchor: 'end' },
  };
}

export function narrowLayout(scene: Scene): Layout {
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
    height: y + 140,
    boxes,
    page: { x: 90, y: 222, w: 180, h: 124 },
    clock: { x: 20, y: 94 },
    caption: { x: 20, y: y + 30, chars: 40, size: 13 },
    sourceCaption: 456,
    footer: y + 124,
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

export function phaseText(scene: Scene, beat: Beat): string {
  return beat.phase === 'source'
    ? phaseLabels.source
    : `${phaseLabels[beat.phase]} · ${beat.phase} ${shortRevision(scene.revisions[beat.phase])}`;
}

function shortRevision(revision: string): string {
  const commit = /[0-9a-f]{7}/.exec(revision)?.[0];

  return revision.startsWith('worktree') && commit !== undefined
    ? `worktree on ${commit}`
    : (revision.split(' · ')[0] ?? revision);
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

function Spinner({ x, y, turn }: { x: number; y: number; turn: number }) {
  return (
    <path
      d={`M ${x + 4} ${y - 4} A 4 4 0 1 1 ${x} ${y}`}
      transform={`rotate(${turn * 720} ${x} ${y - 4})`}
      fill="none"
      strokeWidth={1.4}
      strokeLinecap="round"
      {...stylex.props(styles.spinner)}
    />
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
  const spinner = state.busy ? 14 : 0;
  const titleChars = Math.floor((box.w - 28) / (13 * advance));
  const lineChars = Math.floor((box.w - 28 - spinner) / (12 * advance));

  return (
    <g>
      <rect
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        rx={8}
        strokeWidth={1}
        {...stylex.props(styles[boxTones[state.tone]])}
      />
      <text
        x={box.x + 14}
        y={box.y + box.h / 2 - 4}
        {...stylex.props(
          styles.boxTitle,
          state.tone === 'regression' && styles.lineRegression,
        )}
      >
        {fit(entity.title, titleChars)}
      </text>
      {state.busy ? (
        <Spinner x={box.x + 14} y={box.y + box.h / 2 + 15} turn={progress} />
      ) : null}
      <text
        x={box.x + 14 + spinner}
        y={box.y + box.h / 2 + 15}
        opacity={changed ? progress : 1}
        {...stylex.props(styles.stateLine, styles[lineTones[state.tone]])}
      >
        {fit(state.line, lineChars)}
      </text>
    </g>
  );
}

function PageFrame({
  layout,
  state,
  screenshot,
  fade,
  pattern,
  clip,
}: {
  layout: Layout;
  state: EntityState | undefined;
  screenshot: string | null;
  fade: number;
  pattern: string;
  clip: string;
}) {
  const resolve = use(EvidenceUrls);
  const { page } = layout;
  const chars = Math.floor((page.w + 80) / (12 * advance));

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
      <text
        x={page.x + page.w / 2}
        y={page.y + page.h + 24}
        textAnchor="middle"
        {...stylex.props(styles.boxTitle)}
      >
        page
      </text>
      {state === undefined ? null : (
        <text
          x={page.x + page.w / 2}
          y={page.y + page.h + 43}
          textAnchor="middle"
          {...stylex.props(styles.stateLine, styles[lineTones[state.tone]])}
        >
          {fit(
            screenshot === null ? state.line : `◼ screenshot · ${state.line}`,
            chars,
          )}
        </text>
      )}
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
        opacity={lit ? 1 : 0.4}
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

const codeSigns = { added: '+', removed: '−', same: ' ' } as const;

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
  const { code } = layout;
  const size = layout.kind === 'wide' ? 13 : 11;
  const row = layout.kind === 'wide' ? 24 : 20;
  const gutter = layout.kind === 'wide' ? 64 : 48;
  const chars = Math.floor((code.w - gutter - 24) / (size * advance));
  const place = scene.source?.place ?? '';
  const words = scene.source?.words ?? '';

  return (
    <g opacity={fade}>
      <rect
        x={code.x}
        y={code.y}
        width={code.w}
        height={code.h}
        rx={12}
        strokeWidth={1}
        {...stylex.props(styles.panel)}
      />
      <circle
        cx={code.x + 18}
        cy={code.y + 20}
        r={3}
        {...stylex.props(styles.dotMark)}
      />
      <text x={code.x + 30} y={code.y + 24} {...stylex.props(styles.small)}>
        {fit(place, Math.floor((code.w - 48) / (12 * advance)))}
      </text>
      <line
        x1={code.x}
        x2={code.x + code.w}
        y1={code.y + 40}
        y2={code.y + 40}
        strokeWidth={1}
        {...stylex.props(styles.rule)}
      />
      {source.kind !== 'ready' ? (
        <text
          x={code.x + 24}
          y={code.y + 80}
          {...stylex.props(styles.stateLine, styles.lineQuiet)}
        >
          {source.kind === 'loading'
            ? 'Reading the source snapshot'
            : 'The bundle holds no snapshot of this line'}
        </text>
      ) : (
        source.lines.map((line, index) => {
          const y = code.y + 72 + index * row;
          const annotation = `◂ ${words}`;
          const room = chars - line.text.length - 3;

          return (
            <g key={index}>
              {line.change === 'same' && !line.anchor ? null : (
                <rect
                  x={code.x + 1}
                  y={y - row + 7}
                  width={code.w - 2}
                  height={row}
                  {...stylex.props(
                    line.anchor ? styles.anchorBand : styles.changeBand,
                  )}
                />
              )}
              {line.anchor ? (
                <rect
                  x={code.x + 1}
                  y={y - row + 7}
                  width={3}
                  height={row}
                  {...stylex.props(styles.anchorBar)}
                />
              ) : null}
              <text
                x={code.x + gutter - 30}
                y={y}
                textAnchor="end"
                fontSize={size}
                {...stylex.props(styles.code, styles.lineQuiet)}
              >
                {line.number ?? ''}
              </text>
              <text
                x={code.x + gutter - 18}
                y={y}
                fontSize={size}
                {...stylex.props(styles.code, styles.lineQuiet)}
              >
                {codeSigns[line.change]}
              </text>
              <text
                x={code.x + gutter}
                y={y}
                fontSize={size}
                xmlSpace="preserve"
                {...stylex.props(
                  styles.code,
                  line.change === 'removed' && styles.removed,
                )}
              >
                {fit(line.text, chars)}
              </text>
              {line.anchor && room >= annotation.length ? (
                <text
                  x={code.x + gutter + (line.text.length + 2) * size * advance}
                  y={y}
                  fontSize={size}
                  {...stylex.props(styles.code, styles.annotation)}
                >
                  {annotation}
                </text>
              ) : null}
            </g>
          );
        })
      )}
      <text x={code.x} y={code.y + code.h + 26} {...stylex.props(styles.small)}>
        {layout.kind === 'wide'
          ? 'condensed for display · common indentation removed'
          : 'condensed for display'}
      </text>
    </g>
  );
}

function Emphasized({
  line,
  emphasis,
}: {
  line: string;
  emphasis: Beat['emphasis'];
}) {
  const at = emphasis === null ? -1 : line.indexOf(emphasis.text);

  if (emphasis === null || at === -1) {
    return line;
  }

  return (
    <>
      {line.slice(0, at)}
      <tspan {...stylex.props(styles[lineTones[emphasis.tone]])}>
        {emphasis.text}
      </tspan>
      {line.slice(at + emphasis.text.length)}
    </>
  );
}

export function SceneStage({
  scene,
  layout,
  index,
  progress,
  motion,
  source,
}: {
  scene: Scene;
  layout: Layout;
  index: number;
  progress: number;
  motion: boolean;
  source: SourceText;
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
  const chipWidth = chip.length * 12 * advance + 34;
  const caption = wrap(
    beat.caption,
    layout.caption.chars,
    layout.kind === 'wide' ? 3 : 5,
  );
  const sourcePhase = beat.phase === 'source';
  const titleChars = Math.floor(
    (layout.kind === 'wide' ? 560 : layout.width - 40) / (16 * advance),
  );
  const check = scene.check;
  const checkBox = layout.boxes.get('check');

  return (
    <svg
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      width="100%"
      role="img"
      aria-label={`${scene.title}, ${chip}. ${beat.caption}`}
      data-scene-ready={
        source.kind === 'loading' && scene.source !== null ? undefined : ''
      }
      {...stylex.props(styles.stage)}
    >
      <rect
        width={layout.width}
        height={layout.height}
        {...stylex.props(styles.canvas)}
      />
      <text
        x={layout.kind === 'wide' ? 56 : 20}
        y={layout.kind === 'wide' ? 56 : 38}
        {...stylex.props(styles.title)}
      >
        {fit(scene.title, titleChars)}
      </text>
      <g
        transform={
          layout.kind === 'wide'
            ? `translate(${layout.width - 56 - chipWidth} 36)`
            : 'translate(20 52)'
        }
      >
        <rect
          width={chipWidth}
          height={26}
          rx={13}
          strokeWidth={1}
          {...stylex.props(styles.chip)}
        />
        <circle cx={14} cy={13} r={3.5} {...stylex.props(styles.dotMark)} />
        <text x={24} y={17.5} {...stylex.props(styles.small, styles.chipText)}>
          {chip}
        </text>
      </g>
      {sourcePhase ? (
        <CodeFrame
          scene={scene}
          layout={layout}
          source={source}
          fade={fresh ? progress : 1}
        />
      ) : (
        <g>
          {clock === null ? null : (
            <g transform={`translate(${layout.clock.x} ${layout.clock.y})`}>
              <rect
                width={layout.kind === 'wide' ? 188 : 200}
                height={28}
                rx={14}
                strokeWidth={1}
                {...stylex.props(styles.chip)}
              />
              <text x={14} y={19} {...stylex.props(styles.small)}>
                <tspan {...stylex.props(styles.lineQuiet)}>
                  step {clock.step}/{clock.steps}
                </tspan>
                <tspan dx={12} {...stylex.props(styles.clockValue)}>
                  {seconds(shownElapsed)}
                </tspan>
              </text>
            </g>
          )}
          {scene.edges.map((edge) => {
            const from =
              edge.from === 'page' ? layout.page : layout.boxes.get(edge.from);
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
          <PageFrame
            layout={layout}
            state={beat.states.get('page')}
            screenshot={beat.screenshot}
            fade={previous?.screenshot === beat.screenshot ? 1 : progress}
            pattern={`${ids}-dots`}
            clip={`${ids}-clip`}
          />
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
          {layout.callout === null ||
          checkBox === undefined ||
          check?.measure === undefined ? null : (
            <g>
              <line
                x1={layout.callout.x + 6}
                x2={checkBox.x}
                y1={layout.callout.y - 4}
                y2={checkBox.y + checkBox.h / 2}
                strokeWidth={1}
                {...stylex.props(styles.rule)}
              />
              <text
                x={layout.callout.x}
                y={layout.callout.y}
                textAnchor={layout.callout.anchor}
                {...stylex.props(styles.small)}
              >
                <tspan {...stylex.props(styles.clockValue)}>
                  {check.measure.label.toLowerCase()}
                </tspan>
                <tspan {...stylex.props(styles.lineQuiet)}>
                  {' '}
                  · what the check counts
                </tspan>
              </text>
            </g>
          )}
        </g>
      )}
      <text
        x={layout.caption.x}
        y={sourcePhase ? layout.sourceCaption : layout.caption.y}
        opacity={progress}
        fontSize={layout.caption.size}
        {...stylex.props(styles.caption)}
      >
        {caption.map((line, row) => (
          <tspan
            key={row}
            x={layout.caption.x}
            dy={row === 0 ? 0 : layout.caption.size * 1.5}
          >
            <Emphasized line={line} emphasis={beat.emphasis} />
          </tspan>
        ))}
      </text>
      <text
        x={layout.kind === 'wide' ? 56 : 20}
        y={layout.footer}
        {...stylex.props(styles.footnote)}
      >
        {layout.kind === 'wide'
          ? 'drawn from recorded evidence · not a screen recording'
          : 'drawn from evidence · not a recording'}
      </text>
      {layout.kind === 'wide' ? (
        <text
          x={layout.width - 56}
          y={layout.footer}
          textAnchor="end"
          {...stylex.props(styles.footnote)}
        >
          after {credit.name}
        </text>
      ) : null}
    </svg>
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

function useNarrow(target: RefObject<HTMLElement | null>): boolean {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const element = target.current;

    if (element === null) {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) {
        setNarrow(entry.contentRect.width < 600);
      }
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, [target]);

  return narrow;
}

type Playhead = { index: number; time: number };

export function SceneView({ scene, level }: { scene: Scene; level: 2 | 3 }) {
  const reduced = useReducedMotion();
  const titleId = `${useId()}-scene`;
  const figure = useRef<HTMLDivElement>(null);
  const narrow = useNarrow(figure);
  const [head, setHead] = useState<Playhead>({ index: 0, time: transition });
  const [playing, setPlaying] = useState(false);
  const [announce, setAnnounce] = useState('');
  const started = useRef(false);
  const visible = useRef(false);
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

    const observer = new IntersectionObserver(
      ([entry]) => {
        visible.current = entry?.isIntersecting === true;

        if (!visible.current) {
          setPlaying(false);
        } else if (!started.current && !reduced) {
          started.current = true;
          setHead({ index: 0, time: 0 });
          setPlaying(true);
        }
      },
      { threshold: 0.5 },
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, [reduced]);

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

    setPlaying(false);
    setHead({ index: target, time: reduced ? transition : 0 });
    setAnnounce(scene.beats[target]?.caption ?? '');
  };

  const toggle = () => {
    if (playing) {
      setPlaying(false);

      return;
    }

    setAnnounce('');
    setHead(head.index === last ? { index: 0, time: 0 } : head);
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

  const layout = narrow ? narrowLayout(scene) : wideLayout(scene);
  const progress = reduced ? 1 : Math.min(1, head.time / transition);

  return (
    <section aria-labelledby={titleId} {...stylex.props(styles.section)}>
      <Heading id={titleId} {...stylex.props(styles.heading)}>
        Before and after
      </Heading>
      <p {...stylex.props(styles.text)}>
        Each box shows a value the run recorded. The clock shows recorded time;
        playback holds each step so it can be read.
      </p>
      <div
        ref={figure}
        tabIndex={0}
        role="group"
        aria-roledescription="scene"
        aria-label={`${scene.title}: space plays or pauses, arrow keys step`}
        onKeyDown={keys}
        {...stylex.props(styles.figure)}
      >
        <SceneStage
          scene={scene}
          layout={layout}
          index={head.index}
          progress={progress}
          motion={!reduced}
          source={source}
        />
      </div>
      <div {...stylex.props(styles.controls)}>
        <button
          type="button"
          onClick={() => go(0)}
          {...stylex.props(styles.control)}
        >
          Restart
        </button>
        <button
          type="button"
          aria-label="Previous step"
          disabled={head.index === 0}
          onClick={() => go(head.index - 1)}
          {...stylex.props(styles.control)}
        >
          ◂ Previous
        </button>
        <button
          type="button"
          onClick={toggle}
          aria-pressed={playing}
          {...stylex.props(styles.control, styles.primary)}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          aria-label="Next step"
          disabled={head.index === last}
          onClick={() => go(head.index + 1)}
          {...stylex.props(styles.control)}
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
  stage: { display: 'block', fontFamily: fonts.mono },
  canvas: { fill: colors.canvas },
  title: { fill: colors.text, fontSize: 16 },
  chip: { fill: colors.surface, stroke: colors.border },
  chipText: { fill: colors.textSecondary },
  dotMark: { fill: colors.textMuted },
  small: { fill: colors.textMuted, fontSize: 12 },
  footnote: { fill: colors.textMuted, fontSize: 11 },
  clockValue: { fill: colors.text },
  caption: { fill: colors.text },
  boxQuiet: { fill: colors.surface, stroke: colors.borderControl },
  boxActive: { fill: colors.surfaceMuted, stroke: colors.text },
  boxChecked: { fill: colors.checkedFill, stroke: colors.checked },
  boxRegression: {
    fill: colors.regressionFill,
    stroke: colors.regression,
    strokeWidth: 1.5,
  },
  boxUnknown: { fill: colors.unknownFill, stroke: colors.unknown },
  boxTitle: { fill: colors.text, fontSize: 13 },
  stateLine: { fontSize: 12 },
  lineQuiet: { fill: colors.textMuted },
  lineActive: { fill: colors.textSecondary },
  lineChecked: { fill: colors.checked },
  lineRegression: { fill: colors.regression },
  lineUnknown: { fill: colors.unknown },
  spinner: { stroke: colors.textSecondary },
  dot: { fill: colors.borderControl },
  frame: { stroke: colors.borderControl },
  drives: { stroke: colors.linkImports },
  requested: { stroke: colors.linkRequested, strokeDasharray: '2 4' },
  threw: { stroke: colors.linkThrewAt, strokeDasharray: '9 3 2 3' },
  checkedBy: { stroke: colors.linkCheckedBy, strokeDasharray: '14 4' },
  drivesPulse: { fill: colors.linkImports },
  requestedPulse: { fill: colors.linkRequested },
  threwPulse: { fill: colors.linkThrewAt },
  checkedByPulse: { fill: colors.linkCheckedBy },
  panel: { fill: colors.surface, stroke: colors.border },
  rule: { stroke: colors.border },
  code: { fill: colors.text, whiteSpace: 'pre' },
  removed: { fill: colors.textMuted, textDecoration: 'line-through' },
  changeBand: { fill: colors.surfaceMuted },
  anchorBand: { fill: colors.regressionFill },
  anchorBar: { fill: colors.regression },
  annotation: { fill: colors.regression },
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
    cursor: { default: 'pointer', ':disabled': 'default' },
    fontFamily: fonts.sans,
    fontSize: '0.875rem',
    fontWeight: 500,
    minHeight: geometry.target,
    opacity: { default: 1, ':disabled': 0.5 },
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
    cursor: 'pointer',
    minHeight: geometry.target,
    alignContent: 'center',
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
    paddingBlock: 6,
    paddingInline: 8,
    textAlign: 'start',
    outlineColor: {
      default: 'transparent',
      ':focus-visible': colors.focus,
      [media.forcedColors]: 'Highlight',
    },
    outlineOffset: 2,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
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
