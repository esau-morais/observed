import { evidenceKinds, reactLimits, type Recipe } from '@observed/judge';
import { Effect, Schema, Struct } from 'effect';
import type { Browser } from 'playwright';
import { openSession } from '../session';
import { EvidenceUnavailable, browserCall } from './define';

// React registers with a DevTools hook it finds at startup. Playwright has no
// DevTools backend, so this script installs the part of the hook React calls:
// inject, which returns a renderer ID, and onCommitFiberRoot, from which the
// hook learns each mounted root.
export const hookScript = `(() => {
  if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__ !== undefined) return;
  const renderers = new Map();
  const roots = new Map();
  let next = 1;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers,
    inject(renderer) {
      const id = next++;
      renderers.set(id, renderer);
      roots.set(id, new Set());
      return id;
    },
    getFiberRoots(id) {
      return roots.get(id) ?? new Set();
    },
    onCommitFiberRoot(id, root) {
      const mounted = roots.get(id);
      if (mounted === undefined) return;
      if (root.current.child === null) mounted.delete(root); else mounted.add(root);
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
  };
})();`;

// The recorder follows React DevTools: it descends only where a fiber's child
// list was reconciled in this commit and counts a composite fiber when React
// marked it PerformedWork (flag 1). Tags 0, 1, 2, 11 and 15 are function, class,
// indeterminate, forwardRef and simple memo components; tag 14 (memo) is
// skipped because its inner component is counted.
const recorderPrelude = `
const composite = new Set([0, 1, 2, 11, 15]);
const nameOf = (fiber) => {
  const type = fiber.type;
  const raw = type == null ? null : fiber.tag === 11
    ? type.displayName || (type.render && (type.render.displayName || type.render.name))
    : type.displayName || type.name;
  const name = typeof raw === 'string' ? raw.slice(0, 200).trim() : '';
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

// Commits that land after the last step, such as a timer or a passive
// effect, still belong to the journey. Stopping waits for React to stay
// quiet for a moment and gives up on a page that keeps committing.
const settleRecorder = `new Promise((resolve) => {
  const state = window.__observedReact;
  if (state === undefined) { resolve({ settled: true }); return; }
  const started = performance.now();
  let commits = state.commits;
  let quietSince = started;
  const tick = () => {
    const now = performance.now();
    if (state.commits !== commits) { commits = state.commits; quietSince = now; }
    if (now - quietSince >= 500) resolve({ settled: true });
    else if (now - started >= 5000) resolve({ settled: false });
    else setTimeout(tick, 50);
  };
  tick();
})`;

const startSchema = Schema.Union([
  Schema.Struct({ started: Schema.Literal(true) }),
  Schema.Struct({
    started: Schema.Literal(false),
    reason: Schema.Literals(['hook', 'root', 'active']),
  }),
]);

const stopSchema = Schema.Union([
  Schema.Struct({ active: Schema.Literal(false) }),
  Schema.Struct({
    active: Schema.Literal(true),
    error: Schema.NullOr(Schema.String),
    ...Struct.omit(evidenceKinds.react.value.fields, ['sources']),
  }),
]);

const startFailures = {
  hook: 'The React DevTools hook was not installed in the page',
  root: 'No React root was mounted after the ready steps',
  active: 'A React recording was already active in the page',
} as const;

const evaluate = <S extends Schema.Top & { readonly DecodingServices: never }>({
  page,
  script,
  schema,
  what,
  save,
}: {
  page: { evaluate: <R>(script: string) => Promise<R> };
  script: string;
  schema: S;
  what: string;
  save?: (text: string) => Effect.Effect<void>;
}) =>
  Effect.gen(function* () {
    const text = yield* browserCall(what, () =>
      page.evaluate<string>(`Promise.resolve(${script}).then((value) => JSON.stringify(value))`),
    ).pipe(
      Effect.mapError(() => new EvidenceUnavailable({ reason: `${what} failed in the page` })),
    );

    if (save !== undefined) {
      yield* save(text);
    }

    return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(text).pipe(
      Effect.mapError(
        () => new EvidenceUnavailable({ reason: `${what} returned output Observed cannot read` }),
      ),
    );
  });

// Records which components rendered during the steps, in a browser context
// of its own after the recorded journey. The raw recording is kept as
// react-renders.json.
export const collectReact = Effect.fnUntraced(function* (options: {
  browser: Browser;
  recipe: Recipe;
  url: string;
  fillValues: ReadonlyMap<string, string>;
  save: (text: string) => Effect.Effect<void>;
  onClose: (closed: boolean) => Effect.Effect<void>;
}) {
  const { recipe } = options;
  const session = yield* openSession({
    browser: options.browser,
    recipe,
    url: options.url,
    fillValues: options.fillValues,
    initScripts: [hookScript],
    onClose: options.onClose,
  });
  const { page } = session;
  const fail = (reason: string) => new EvidenceUnavailable({ reason });

  yield* session.open();
  yield* session.runAll('Ready step', recipe.ready);

  const started = yield* evaluate({
    page,
    script: startRecorder,
    schema: startSchema,
    what: 'Starting the React recorder',
  });

  if (!started.started) {
    return yield* fail(startFailures[started.reason]);
  }

  yield* session.runAll('Step', recipe.steps);

  const settled = yield* evaluate({
    page,
    script: settleRecorder,
    schema: Schema.Struct({ settled: Schema.Boolean }),
    what: 'Waiting for React to settle',
  });

  if (!settled.settled) {
    return yield* fail(
      'React kept committing for 5 seconds after the last step, so render counts would depend on timing',
    );
  }

  const recording = yield* evaluate({
    page,
    script: stopRecorder,
    schema: stopSchema,
    what: 'Reading the React recording',
    save: options.save,
  });

  if (!recording.active) {
    return yield* fail(
      'The page loaded a new document during steps, which discarded the React recording',
    );
  }

  if (recording.error !== null) {
    return yield* fail(`The React recorder failed during steps: ${recording.error}`);
  }

  return yield* Schema.decodeUnknownEffect(evidenceKinds.react.value)({
    renderers: recording.renderers,
    commits: recording.commits,
    components: recording.components,
    mounted: recording.mounted,
    subtree: recording.subtree,
    sources: [],
    truncated: recording.truncated,
  }).pipe(Effect.mapError(() => fail('The React recording exceeded its limits or repeated names')));
}, Effect.scoped);
