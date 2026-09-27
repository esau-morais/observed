import { Effect, Schema, Struct } from 'effect';
import {
  reactLimits,
  reactValueSchema,
  type ReactEvidence,
} from '../../evidence-kinds/react';
import {
  EvidenceUnavailable,
  type Collector,
  type SeparateSessionContext,
} from './define';

// agent-browser 0.38.1's `react renders` counts every fiber whose props or
// state differ from its alternate on each commit, so a component that bailed
// out is counted again from stale buffers. This recorder follows React
// DevTools instead: it descends only where a fiber's child list was
// reconciled in this commit and counts a composite fiber when React marked
// it PerformedWork (flag 1). Tags 0, 1, 2, 11 and 15 are function, class,
// indeterminate, forwardRef and simple memo components; tag 14 (memo) is
// skipped because its inner component is counted.
const recorderPrelude = `
const composite = new Set([0, 1, 2, 11, 15]);
const nameOf = (fiber) => {
  const type = fiber.type;
  const raw = type == null ? null : fiber.tag === 11
    ? type.displayName || (type.render && (type.render.displayName || type.render.name))
    : type.displayName || type.name;
  const name = typeof raw === 'string' ? raw.trim().slice(0, 200) : '';
  return name === '' ? 'Anonymous' : name;
};
const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
const roots = () => hook && hook.renderers && hook.getFiberRoots
  ? [...hook.renderers.keys()].flatMap((id) => [...hook.getFiberRoots(id)])
  : [];
`;

const startRecorder = `(() => {
${recorderPrelude}
if (!hook || typeof hook.onCommitFiberRoot !== 'function') return { started: false, reason: 'hook' };
if (roots().length === 0) return { started: false, reason: 'root' };
if (window.__observedReact !== undefined) return { started: false, reason: 'active' };
const state = { commits: 0, counts: new Map(), rendered: new WeakSet(), overflow: false, error: null };
const record = (fiber, phase) => {
  const name = nameOf(fiber);
  let entry = state.counts.get(name);
  if (entry === undefined) {
    if (state.counts.size >= ${reactLimits.components}) { state.overflow = true; return; }
    entry = { mounts: 0, updates: 0 };
    state.counts.set(name, entry);
  }
  entry[phase] += 1;
  state.rendered.add(fiber);
};
const mount = (fiber) => {
  if (composite.has(fiber.tag)) record(fiber, 'mounts');
  for (let child = fiber.child; child !== null; child = child.sibling) mount(child);
};
const update = (next, previous) => {
  if (composite.has(next.tag) && (next.flags & 1) === 1) record(next, 'updates');
  if (next.child === previous.child) return;
  for (let child = next.child; child !== null; child = child.sibling) {
    if (child.alternate === null) mount(child); else update(child, child.alternate);
  }
};
const original = hook.onCommitFiberRoot;
hook.onCommitFiberRoot = function (id, root, ...rest) {
  try {
    state.commits += 1;
    const current = root.current;
    if (current.alternate === null) mount(current); else update(current, current.alternate);
  } catch (error) {
    state.error = String(error).slice(0, 500);
  }
  return original.call(this, id, root, ...rest);
};
window.__observedReact = state;
return { started: true };
})()`;

const stopRecorder = `(() => {
${recorderPrelude}
const state = window.__observedReact;
if (state === undefined) return { active: false };
const mounted = new Set();
let mountedOverflow = false;
const subtree = [];
let subtreeOverflow = false;
const walk = (fiber, depth) => {
  const isComposite = composite.has(fiber.tag);
  let entry = null;
  if (isComposite) {
    const name = nameOf(fiber);
    if (mounted.size < ${reactLimits.mounted}) mounted.add(name); else if (!mounted.has(name)) mountedOverflow = true;
    entry = { name, depth, rendered: state.rendered.has(fiber) || (fiber.alternate !== null && state.rendered.has(fiber.alternate)) };
  }
  const index = subtree.length;
  if (entry !== null) subtree.push(entry);
  let touched = false;
  for (let child = fiber.child; child !== null; child = child.sibling) {
    if (walk(child, entry === null ? depth : depth + 1)) touched = true;
  }
  if (entry === null) return touched;
  if (entry.rendered || touched) return true;
  subtree.splice(index);
  return false;
};
for (const root of roots()) walk(root.current, 0);
if (subtree.length > ${reactLimits.subtree}) { subtree.length = ${reactLimits.subtree}; subtreeOverflow = true; }
return {
  active: true,
  error: state.error,
  renderers: [...hook.renderers.values()].map((renderer) => ({
    version: typeof renderer.version === 'string' && renderer.version.trim() !== '' ? renderer.version.trim() : null,
    build: renderer.bundleType === 0 ? 'production' : 'development',
  })),
  commits: state.commits,
  components: [...state.counts].map(([name, entry]) => ({ name, ...entry })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  mounted: [...mounted].sort(),
  subtree,
  truncated: { components: state.overflow, mounted: mountedOverflow, subtree: subtreeOverflow },
};
})()`;

const evalResult = <S extends Schema.Constraint>(result: S) =>
  Schema.fromJsonString(
    Schema.Struct({
      success: Schema.Literal(true),
      data: Schema.Struct({ result }),
    }),
  );

const startSchema = evalResult(
  Schema.Union([
    Schema.Struct({ started: Schema.Literal(true) }),
    Schema.Struct({
      started: Schema.Literal(false),
      reason: Schema.Literals(['hook', 'root', 'active']),
    }),
  ]),
);

const stopSchema = evalResult(
  Schema.Union([
    Schema.Struct({ active: Schema.Literal(false) }),
    Schema.Struct({
      active: Schema.Literal(true),
      error: Schema.NullOr(Schema.String),
      ...Struct.omit(reactValueSchema.fields, ['sources']),
    }),
  ]),
);

const treeSchema = Schema.fromJsonString(
  Schema.Struct({
    success: Schema.Literal(true),
    data: Schema.Struct({ tree: Schema.String }),
  }),
);

const inspectSchema = Schema.fromJsonString(
  Schema.Struct({
    success: Schema.Literal(true),
    data: Schema.Struct({
      source: Schema.optionalKey(
        Schema.NullOr(
          Schema.Tuple([
            Schema.String,
            Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
            Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
          ]),
        ),
      ),
    }),
  }),
);

// `react tree` rows are "depth id parent name [key=...]"; the first node with
// a component's name supplies the fiber ID that `react inspect` accepts.
export function treeIds(tree: string): Map<string, string> {
  const ids = new Map<string, string>();

  for (const line of tree.split('\n')) {
    const match = /^\d+ (\d+) (?:\d+|-) (.+?)(?: key=.*)?$/.exec(line);
    const [, id, name] = match ?? [];

    if (id !== undefined && name !== undefined && !ids.has(name)) {
      ids.set(name, id);
    }
  }

  return ids;
}

export function scriptLocation(source: string, application: string): string {
  const url = URL.parse(source);

  if (url === null) {
    return source;
  }

  return url.origin === new URL(application).origin
    ? url.pathname
    : `${url.origin}${url.pathname}`;
}

const decode = <S extends Schema.Constraint>(
  schema: S,
  input: string,
  reason: string,
) =>
  Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.mapError(() => new EvidenceUnavailable({ reason })),
  );

const base64 = (script: string) => Buffer.from(script).toString('base64');

const startFailures = {
  hook: 'The React DevTools hook was not installed in the page',
  root: 'No React root was mounted after the ready steps',
  active: 'A React recording was already active in the page',
} as const;

const collectReact = Effect.fnUntraced(function* (
  context: SeparateSessionContext,
) {
  const { recipe } = context;

  yield* context.browser([
    'open',
    new URL(recipe.path, context.url).toString(),
  ]);
  yield* context.browser([
    'set',
    'viewport',
    String(recipe.viewport.width),
    String(recipe.viewport.height),
    String(recipe.viewport.scale),
  ]);
  yield* context.browser(['set', 'media', 'light', 'reduced-motion']);
  yield* context.runSteps(recipe.ready);

  const started = yield* decode(
    startSchema,
    yield* context.saveOutput('react-start', 'react-start.json', [
      'eval',
      '-b',
      base64(startRecorder),
    ]),
    'The React recorder did not report whether it started',
  );

  if (!started.data.result.started) {
    return yield* new EvidenceUnavailable({
      reason: startFailures[started.data.result.reason],
    });
  }

  yield* context.runSteps(recipe.steps);

  const stopped = yield* decode(
    stopSchema,
    yield* context.saveOutput('react-renders', 'react-renders.json', [
      'eval',
      '-b',
      base64(stopRecorder),
    ]),
    'The React recorder returned output Observed cannot read',
  );
  const recording = stopped.data.result;

  if (!recording.active) {
    return yield* new EvidenceUnavailable({
      reason:
        'The page loaded a new document during steps, which discarded the React recording',
    });
  }

  if (recording.error !== null) {
    return yield* new EvidenceUnavailable({
      reason: `The React recorder failed during steps: ${recording.error}`,
    });
  }

  const tree = yield* decode(
    treeSchema,
    yield* context.saveOutput('react-tree', 'react-tree.json', [
      'react',
      'tree',
    ]),
    'agent-browser returned a React tree Observed cannot read',
  );
  const ids = treeIds(tree.data.tree);
  const sources: ReactEvidence['sources'][number][] = [];

  for (const component of recording.components.slice(0, reactLimits.sources)) {
    const id = ids.get(component.name);

    if (id === undefined) {
      continue;
    }

    const inspected = yield* decode(
      inspectSchema,
      yield* context.saveOutput(
        `react-inspect-${sources.length + 1}`,
        `react-inspect-${id}.json`,
        ['react', 'inspect', id],
      ),
      `agent-browser returned React details for ${component.name} that Observed cannot read`,
    );
    const source = inspected.data.source;

    if (source !== undefined && source !== null && source[0] !== '') {
      sources.push({
        component: component.name,
        script: scriptLocation(source[0], context.url),
        line: source[1],
        column: source[2],
      });
    }
  }

  return yield* Schema.decodeUnknownEffect(reactValueSchema)({
    renderers: recording.renderers,
    commits: recording.commits,
    components: recording.components,
    mounted: recording.mounted,
    subtree: recording.subtree,
    sources,
    truncated: recording.truncated,
  }).pipe(
    Effect.mapError(
      () =>
        new EvidenceUnavailable({
          reason: 'The React recording exceeded its limits or repeated names',
        }),
    ),
  );
});

export const react: Collector<'react'> = {
  phase: 'separate-session',
  launchArguments: ['--enable', 'react-devtools'],
  collect: (_config, context) => collectReact(context),
};
