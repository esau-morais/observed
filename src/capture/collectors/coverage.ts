import { Effect, FileSystem, Option, Schema } from 'effect';
import path from 'node:path';
import type {
  CoverageEvidence,
  LineRange,
} from '../../evidence-kinds/coverage';
import { json } from '../../encoding';
import {
  parseSourceMap,
  segments,
  snapshotPath,
  sourceName,
  type SourceMap,
} from '../../source-map';
import { connectCdp, type CdpConnection } from '../cdp';
import { findSourceMap, maxMappedScripts } from '../source-maps';
import {
  EvidenceUnavailable,
  type Collector,
  type SeparateSessionContext,
} from './define';
import { scriptLocation } from './react';

const commandTimeoutMs = 20_000;
// A slow repeat of the journey loses coverage instead of using up the
// capture's whole timeout.
const coverageTimeoutMs = 60_000;
// Map fetching runs inside the capture's own timeout, so it stops starting
// new fetches after this long.
const deadlineMs = 20_000;

const offset = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const functionSchema = Schema.Struct({
  functionName: Schema.String,
  ranges: Schema.Array(
    Schema.Struct({ startOffset: offset, endOffset: offset, count: offset }),
  ),
});

export type CoveredFunction = typeof functionSchema.Type;

// Profiler.takePreciseCoverage, from
// https://chromedevtools.github.io/devtools-protocol/tot/Profiler/#method-takePreciseCoverage
const takenSchema = Schema.Struct({
  result: Schema.Array(
    Schema.Struct({
      scriptId: Schema.String,
      url: Schema.String,
      functions: Schema.Array(functionSchema),
    }),
  ),
});

const attachedSchema = Schema.Struct({ sessionId: Schema.NonEmptyString });
const scriptSourceSchema = Schema.Struct({ scriptSource: Schema.String });

const agentBrowserJson = <S extends Schema.Constraint>(data: S) =>
  Schema.fromJsonString(Schema.Struct({ success: Schema.Literal(true), data }));

const tabsSchema = agentBrowserJson(
  Schema.Struct({
    tabs: Schema.Array(
      Schema.Struct({
        active: Schema.Boolean,
        targetId: Schema.NonEmptyString,
        url: Schema.String,
      }),
    ),
  }),
);

const cdpUrlSchema = agentBrowserJson(
  Schema.Struct({ cdpUrl: Schema.NonEmptyString }),
);

const unavailable = (reason: string) => new EvidenceUnavailable({ reason });

const decode = <S extends Schema.Constraint>(
  schema: S,
  input: unknown,
  reason: string,
) =>
  Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.mapError(() => unavailable(reason)),
  );

type Span = { start: number; end: number; count: number };

// V8 block coverage nests ranges: a function's first range spans the whole
// function, and later ranges mark blocks inside it. The innermost range
// holding an offset gives its count, so nested ranges are flattened into
// non-overlapping spans.
export function flattenRanges(functions: readonly CoveredFunction[]): Span[] {
  const ranges = functions
    .flatMap((item) =>
      item.ranges.map((range) => ({
        start: range.startOffset,
        end: range.endOffset,
        count: range.count,
      })),
    )
    .filter((range) => range.start < range.end)
    .toSorted((left, right) =>
      left.start === right.start
        ? right.end - left.end
        : left.start - right.start,
    );
  const spans: Span[] = [];
  const open: Span[] = [];
  let position = 0;

  const advance = (to: number) => {
    while (open.length > 0 && position < to) {
      const top = open.at(-1);

      if (top === undefined || top.end <= position) {
        open.pop();
        continue;
      }

      const end = Math.min(top.end, to);

      spans.push({ start: position, end, count: top.count });
      position = end;
    }

    position = Math.max(position, to);
  };

  for (const range of ranges) {
    advance(range.start);
    open.push(range);
  }

  advance(Number.POSITIVE_INFINITY);

  return spans;
}

function countAt(spans: readonly Span[], at: number): number | null {
  let low = 0;
  let high = spans.length - 1;

  while (low <= high) {
    const middle = (low + high) >> 1;
    const span = spans[middle];

    if (span === undefined) {
      return null;
    }

    if (at < span.start) {
      high = middle - 1;
    } else if (at >= span.end) {
      low = middle + 1;
    } else {
      return span.count;
    }
  }

  return null;
}

// Original line numbers per snapshot file, with whether any generated code
// mapped to that line ran. Each mapping segment takes the count at its first
// generated character. Lines that no segment maps to are absent.
export type LineRuns = Map<string, Map<number, boolean>>;

// Each entry of `copies` is one load of the script, with its own counts. A
// line counts as run when it ran in any copy.
export function lineRuns(options: {
  source: string;
  map: SourceMap;
  copies: readonly (readonly CoveredFunction[])[];
  // Snapshot paths by the map's source index. Other sources are skipped.
  paths: ReadonlyMap<number, string>;
}): LineRuns | null {
  const all = segments(options.map);

  if (all === null) {
    return null;
  }

  const lineStarts = [0];

  for (let index = 0; index < options.source.length; index++) {
    if (options.source.charCodeAt(index) === 10) {
      lineStarts.push(index + 1);
    }
  }

  const runs: LineRuns = new Map();

  for (const functions of options.copies) {
    const spans = flattenRanges(functions);

    for (const segment of all) {
      const start = lineStarts[segment.generatedLine];

      if (segment.original === null || start === undefined) {
        continue;
      }

      const file = options.paths.get(segment.original.source);
      const count = countAt(spans, start + segment.generatedColumn);

      if (file === undefined || count === null) {
        continue;
      }

      const lines = runs.get(file) ?? new Map<number, boolean>();
      const line = segment.original.line + 1;

      lines.set(line, lines.get(line) === true || count > 0);
      runs.set(file, lines);
    }
  }

  return runs;
}

function toRanges(lines: readonly number[]): LineRange[] {
  const ranges: [number, number][] = [];

  for (const line of lines.toSorted((left, right) => left - right)) {
    const last = ranges.at(-1);

    if (last !== undefined && last[1] === line - 1) {
      last[1] = line;
    } else {
      ranges.push([line, line]);
    }
  }

  return ranges;
}

// A line that ran in any script counts as executed.
export function coverageFiles(
  all: readonly LineRuns[],
): CoverageEvidence['files'] {
  const merged: LineRuns = new Map();

  for (const runs of all) {
    for (const [file, lines] of runs) {
      const into = merged.get(file) ?? new Map<number, boolean>();

      for (const [line, ran] of lines) {
        into.set(line, into.get(line) === true || ran);
      }

      merged.set(file, into);
    }
  }

  return [...merged]
    .toSorted(([left], [right]) => (left < right ? -1 : 1))
    .map(([file, lines]) => {
      const entries = [...lines];

      return {
        path: file,
        executed: toRanges(
          entries.filter(([, ran]) => ran).map(([line]) => line),
        ),
        unexecuted: toRanges(
          entries.filter(([, ran]) => !ran).map(([line]) => line),
        ),
      };
    });
}

function skipReason(index: number, elapsedMs: number): string | null {
  if (index >= maxMappedScripts) {
    return `Only the first ${maxMappedScripts} scripts are mapped`;
  }

  return elapsedMs > deadlineMs
    ? `Map fetching stopped after ${deadlineMs / 1000} seconds`
    : null;
}

type Script = {
  readonly location: string;
  readonly url: URL;
  readonly ids: readonly string[];
  readonly functions: readonly (readonly CoveredFunction[])[];
};

// Scripts without an http(s) address, such as evaluated code and the
// browser's own scripts, belong to no application file and are left out.
function groupScripts(
  taken: typeof takenSchema.Type,
  application: string,
): Script[] {
  const scripts = new Map<string, Script>();

  for (const entry of taken.result) {
    const url = URL.parse(entry.url);

    if (url === null || !['http:', 'https:'].includes(url.protocol)) {
      continue;
    }

    const location = scriptLocation(entry.url, application);
    const known = scripts.get(location);

    scripts.set(location, {
      location,
      url,
      ids: [...(known?.ids ?? []), entry.scriptId],
      functions: [...(known?.functions ?? []), entry.functions],
    });
  }

  return [...scripts.values()].toSorted((left, right) =>
    left.location < right.location ? -1 : 1,
  );
}

const differs =
  "The source map's copy of this file differs from the source snapshot, so its line numbers would not match";

// A map's line numbers count lines of the text it was made from. When a
// build step drops its own map, that text is an intermediate output rather
// than the snapshot file, so a map that embeds a different copy is not used
// for that file. A map without embedded copies cannot be checked this way.
const snapshotSources = Effect.fnUntraced(function* (
  map: SourceMap,
  context: SeparateSessionContext,
) {
  const fs = yield* FileSystem.FileSystem;
  const paths = new Map<number, string>();
  const excluded = new Map<string, string>();

  for (const index of map.sources.keys()) {
    const name = sourceName(map, index);
    const file = name === null ? null : snapshotPath(name, context.sourceFiles);

    if (file === null) {
      continue;
    }

    const embedded = map.sourcesContent?.[index];

    if (embedded !== undefined && embedded !== null) {
      const snapshot = yield* fs
        .readFileString(path.join(context.directory, 'source', file))
        .pipe(Effect.orElseSucceed(() => null));

      if (snapshot !== embedded) {
        excluded.set(
          file,
          snapshot === null
            ? 'The source snapshot of this file could not be read'
            : differs,
        );
        continue;
      }
    }

    paths.set(index, file);
  }

  return {
    paths,
    excluded: [...excluded]
      .filter(([file]) => ![...paths.values()].includes(file))
      .map(([file, reason]) => ({ path: file, reason })),
  };
});

const resolveScript = Effect.fnUntraced(function* (
  cdp: CdpConnection,
  sessionId: string,
  script: Script,
  context: SeparateSessionContext,
) {
  const origin = new URL(context.url).origin;

  if (script.url.origin !== origin) {
    return {
      kind: 'unavailable',
      reason: "Loaded from outside the application's origin",
    } as const;
  }

  const sources = yield* Effect.forEach(script.ids, (scriptId) =>
    cdp.send('Debugger.getScriptSource', { scriptId }, sessionId).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(scriptSourceSchema)),
      Effect.map((reply) => reply.scriptSource),
    ),
  ).pipe(Effect.option);

  if (Option.isNone(sources)) {
    return {
      kind: 'unavailable',
      reason: 'The browser did not return the script source',
    } as const;
  }

  const [text, ...others] = sources.value;

  // Inline scripts share their page's address, and one map cannot describe
  // several different texts.
  if (text === undefined || others.some((other) => other !== text)) {
    return {
      kind: 'unavailable',
      reason: 'Several scripts with different text share this address',
    } as const;
  }

  const found = yield* findSourceMap(script.url, origin, text);

  if (found.kind === 'missing') {
    return {
      kind: 'unavailable',
      reason: `No source map: ${found.reason}`,
    } as const;
  }

  const map = parseSourceMap(found.text);

  if (map === null) {
    return {
      kind: 'unavailable',
      reason: 'The source map is not a version 3 source map',
    } as const;
  }

  const { paths, excluded } = yield* snapshotSources(map, context);
  const runs = lineRuns({
    source: text,
    map,
    copies: script.functions,
    paths,
  });

  if (runs === null) {
    return {
      kind: 'unavailable',
      reason: 'The source map has malformed mappings',
    } as const;
  }

  // A map that names only dependencies or files outside the snapshot, such
  // as a vendor chunk, is mapped and contributes no captured file.
  const named = [...runs.keys()];

  return {
    kind: 'mapped',
    files: named.sort(),
    excluded,
    runs,
  } as const;
});

const cdpCommand = (
  cdp: CdpConnection,
  method: string,
  params: Readonly<Record<string, unknown>> = {},
  sessionId?: string,
) =>
  cdp
    .send(method, params, sessionId)
    .pipe(
      Effect.mapError((failure) =>
        unavailable(`DevTools ${method} failed: ${failure.message}`),
      ),
    );

const collectCoverage = Effect.fnUntraced(function* (
  context: SeparateSessionContext,
) {
  const { recipe } = context;

  // The session's first browser call launches it on a blank tab. Coverage
  // must start on that tab before the first navigation, so code that runs
  // while the page loads is counted. Under --allowed-domains, agent-browser
  // 0.38.1 answers `open about:blank` with "No hostname in URL" (run on
  // 2026-10-03), so the tab cannot be reset that way.
  const tabs = yield* decode(
    tabsSchema,
    yield* context.browser(['tab', 'list']),
    'agent-browser did not list the coverage session tabs',
  );
  const tab = tabs.data.tabs.find((item) => item.active);

  if (tab?.url !== 'about:blank') {
    return yield* unavailable(
      'The coverage session did not start on a blank tab, so coverage could not begin before the page loaded',
    );
  }

  const address = yield* decode(
    cdpUrlSchema,
    yield* context.browser(['get', 'cdp-url']),
    'agent-browser did not report the DevTools address',
  );

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const cdp = yield* connectCdp(address.data.cdpUrl, commandTimeoutMs).pipe(
        Effect.mapError((failure) =>
          unavailable(`DevTools connection failed: ${failure.message}`),
        ),
      );
      const attached = yield* decode(
        attachedSchema,
        yield* cdpCommand(cdp, 'Target.attachToTarget', {
          targetId: tab.targetId,
          flatten: true,
        }),
        'DevTools did not attach to the coverage tab',
      );
      const session = attached.sessionId;

      yield* cdpCommand(cdp, 'Profiler.enable', {}, session);
      yield* cdpCommand(
        cdp,
        'Profiler.startPreciseCoverage',
        { callCount: true, detailed: true },
        session,
      );
      // The debugger keeps each script's source for mapping offsets. Pauses
      // are skipped so a `debugger` statement cannot stop the journey.
      yield* cdpCommand(cdp, 'Debugger.enable', {}, session);
      yield* cdpCommand(
        cdp,
        'Debugger.setSkipAllPauses',
        { skip: true },
        session,
      );

      // A repeated journey can fail where the first run passed, such as one
      // that creates a record with a unique name. That loses coverage, not
      // the capture.
      yield* Effect.gen(function* () {
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
        yield* context.runSteps(recipe.steps);
      }).pipe(
        Effect.mapError((failure) =>
          failure._tag === 'EvidenceUnavailable'
            ? failure
            : unavailable(
                `The journey failed in the coverage session: ${failure.message}`,
              ),
        ),
      );

      const raw = yield* cdpCommand(
        cdp,
        'Profiler.takePreciseCoverage',
        {},
        session,
      );

      yield* context.saveText(
        'coverage-raw',
        'coverage-raw.json',
        'DevTools precise coverage, as Profiler.takePreciseCoverage returned it',
        json(raw),
      );

      const taken = yield* decode(
        takenSchema,
        raw,
        'DevTools returned coverage Observed cannot read',
      );
      const scripts: CoverageEvidence['scripts'][number][] = [];
      const runs: LineRuns[] = [];
      const started = Date.now();

      for (const [index, script] of groupScripts(
        taken,
        context.url,
      ).entries()) {
        const skipped = skipReason(index, Date.now() - started);
        const resolved =
          skipped === null
            ? yield* resolveScript(cdp, session, script, context)
            : ({ kind: 'unavailable', reason: skipped } as const);

        if (resolved.kind === 'mapped') {
          runs.push(resolved.runs);
          scripts.push({
            script: script.location,
            kind: 'mapped',
            files: resolved.files,
            excluded: resolved.excluded,
          });
        } else {
          scripts.push({ script: script.location, ...resolved });
        }
      }

      return { files: coverageFiles(runs), scripts };
    }),
  );
});

export const coverage: Collector<'coverage'> = {
  phase: 'separate-session',
  skip: (config) =>
    config.enabled === false
      ? 'Coverage is turned off for this journey in observed.json'
      : null,
  collect: (_config, context) =>
    collectCoverage(context).pipe(
      Effect.timeoutOrElse({
        duration: coverageTimeoutMs,
        orElse: () =>
          Effect.fail(
            unavailable(
              `Coverage took longer than ${coverageTimeoutMs / 1000} seconds`,
            ),
          ),
      }),
    ),
};
