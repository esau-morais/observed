import { realpathSync } from 'node:fs';
import path from 'node:path';
import type {
  ChangeMap,
  ChangeScope,
  Journey,
  MapBlock,
  MapConnection,
  MapEvidence,
  Side,
} from './comparison-model';
import { addedLines, type CoverageRecord } from './change-scope';

// The verified text of a snapshot's files and the directory that holds them
// on disk, which import resolution reads.
export type MapSnapshot = {
  root: string;
  files: ReadonlyMap<string, string>;
};

export type MapJourney = { journey: Journey; coverage: CoverageRecord };

type Target =
  { kind: 'file'; path: string } | { kind: 'package'; name: string };

type FileImports =
  | { kind: 'scanned'; targets: Target[]; unresolved: string[] }
  | { kind: 'unavailable'; reason: string };

const loaders = new Map<string, 'js' | 'jsx' | 'ts' | 'tsx'>([
  ['.js', 'js'],
  ['.mjs', 'js'],
  ['.cjs', 'js'],
  ['.jsx', 'jsx'],
  ['.ts', 'ts'],
  ['.mts', 'ts'],
  ['.cts', 'ts'],
  ['.tsx', 'tsx'],
]);

const declaration = /\.d\.[cm]?ts$/;

export const importReasons = {
  language:
    'Import connections are read only from JavaScript and TypeScript files.',
  declaration: 'A type declaration file has no runtime imports.',
  parse: 'Bun could not parse this file, so its imports are unknown.',
} as const;

function loaderOf(file: string) {
  return declaration.test(file) ? undefined : loaders.get(path.extname(file));
}

function packageName(specifier: string): string {
  const parts = specifier.split('/');

  return specifier.startsWith('@') && parts.length > 1
    ? `${parts[0]}/${parts[1]}`
    : (parts[0] ?? specifier);
}

function isRelative(specifier: string): boolean {
  return (
    specifier === '.' ||
    specifier === '..' ||
    specifier.startsWith('./') ||
    specifier.startsWith('../') ||
    specifier.startsWith('/')
  );
}

// Prefixes of the `paths` aliases in the snapshot's tsconfig and jsconfig
// files. A bare specifier is resolved only when it matches one: resolving a
// package name makes Bun install a package it cannot find (Bun 1.4.2,
// checked 2026-10-03).
function aliasPrefixes(files: ReadonlyMap<string, string>): string[] {
  const prefixes: string[] = [];

  for (const [file, text] of files) {
    if (!/(?:^|\/)[tj]sconfig(?:\.[^/]*)?\.json$/.test(file)) {
      continue;
    }

    let parsed: unknown;

    try {
      parsed = Bun.JSONC.parse(text);
    } catch {
      continue;
    }

    const paths =
      typeof parsed === 'object' &&
      parsed !== null &&
      'compilerOptions' in parsed &&
      typeof parsed.compilerOptions === 'object' &&
      parsed.compilerOptions !== null &&
      'paths' in parsed.compilerOptions &&
      typeof parsed.compilerOptions.paths === 'object' &&
      parsed.compilerOptions.paths !== null
        ? Object.keys(parsed.compilerOptions.paths)
        : [];

    prefixes.push(...paths.map((key) => key.replace(/\*.*$/, '')));
  }

  return prefixes.filter((prefix) => prefix !== '');
}

function resolveIn(
  snapshot: MapSnapshot & { real: string },
  from: string,
  specifier: string,
): string | null {
  let resolved: string;

  try {
    resolved = Bun.resolveSync(
      specifier,
      path.dirname(path.join(snapshot.real, from)),
    );
  } catch {
    return null;
  }

  const relative = path.relative(snapshot.real, resolved);

  return relative.startsWith('..') ||
    path.isAbsolute(relative) ||
    !snapshot.files.has(relative.split(path.sep).join('/'))
    ? null
    : relative.split(path.sep).join('/');
}

// The runtime imports of every JavaScript and TypeScript file in a snapshot.
// `Bun.Transpiler.scan` drops type-only imports.
export function snapshotImports(
  snapshot: MapSnapshot,
): Map<string, FileImports> {
  const real = { ...snapshot, real: realpathSync(snapshot.root) };
  const aliases = aliasPrefixes(snapshot.files);
  const result = new Map<string, FileImports>();

  for (const [file, text] of snapshot.files) {
    const loader = loaderOf(file);

    if (loader === undefined) {
      result.set(file, {
        kind: 'unavailable',
        reason: declaration.test(file)
          ? importReasons.declaration
          : importReasons.language,
      });
      continue;
    }

    let specifiers: string[];

    try {
      specifiers = new Bun.Transpiler({ loader })
        .scan(text)
        .imports.map((item) => item.path);
    } catch {
      result.set(file, { kind: 'unavailable', reason: importReasons.parse });
      continue;
    }

    const targets: Target[] = [];
    const unresolved: string[] = [];

    for (const specifier of new Set(specifiers)) {
      const local =
        isRelative(specifier) ||
        aliases.some((prefix) => specifier.startsWith(prefix));
      const resolved = local ? resolveIn(real, file, specifier) : null;

      if (resolved !== null) {
        targets.push({ kind: 'file', path: resolved });
      } else if (isRelative(specifier)) {
        unresolved.push(specifier);
      } else {
        targets.push({ kind: 'package', name: packageName(specifier) });
      }
    }

    result.set(file, { kind: 'scanned', targets, unresolved });
  }

  return result;
}

function blockImports(
  read: FileImports | undefined,
): Extract<MapBlock, { kind: 'file' }>['imports'] {
  if (read === undefined) {
    return { kind: 'unavailable', reason: importReasons.language };
  }

  return read.kind === 'scanned'
    ? { kind: 'scanned', unresolved: read.unresolved }
    : read;
}

const fileId = (file: string) => `file:${file}`;
const packageId = (name: string) => `package:${name}`;
const journeyId = (index: number) => `journey:${index + 1}`;
const routeId = (method: string, route: string) => `route:${method} ${route}`;

function targetId(target: Target): string {
  return target.kind === 'file' ? fileId(target.path) : packageId(target.name);
}

// The report path of a verified artifact the capture listed under `file`.
function artifactPath(side: Side, file: string): string | null {
  const listed = side.capture?.manifest.artifacts.find(
    (item) => item.path === file,
  );
  const shown = side.artifacts.find((item) => item.id === listed?.id);

  return shown?.integrity === 'verified' ? shown.path : null;
}

function within(line: number, ranges: readonly (readonly [number, number])[]) {
  return ranges.some(([start, end]) => start <= line && line <= end);
}

type Edge = { from: string; to: string };

function edgeKey({ from, to }: Edge): string {
  return `${from}\u0000${to}`;
}

function importEdges(
  imports: ReadonlyMap<string, FileImports>,
  side: Side,
): Map<string, Edge & { evidence: MapEvidence }> {
  const edges = new Map<string, Edge & { evidence: MapEvidence }>();

  for (const [file, read] of imports) {
    const evidence = artifactPath(side, `source/${file}`);

    if (read.kind !== 'scanned' || evidence === null) {
      continue;
    }

    for (const target of read.targets) {
      const edge = { from: fileId(file), to: targetId(target) };

      edges.set(edgeKey(edge), {
        ...edge,
        evidence: { kind: 'artifact', path: evidence },
      });
    }
  }

  return edges;
}

function requestCounts(side: Side) {
  const counts = new Map<string, { count: number; statuses: Set<number> }>();

  if (side.execution !== 'complete') {
    return null;
  }

  for (const request of side.observations.requests) {
    const key = `${request.method} ${request.origin === 'application' ? '' : request.origin}${request.path}`;
    const entry = counts.get(key) ?? { count: 0, statuses: new Set() };

    entry.count += 1;
    entry.statuses.add(request.status);
    counts.set(key, entry);
  }

  return counts;
}

function journeyConnections(
  { journey, coverage }: MapJourney,
  index: number,
  changed: ReadonlyMap<string, readonly number[] | null>,
): { connections: MapConnection[]; routes: MapBlock[] } {
  const id = journeyId(index);
  const connections: MapConnection[] = [];
  const routes: MapBlock[] = [];

  if (coverage.kind === 'recorded') {
    const coverageFile = journey.candidate.capture?.manifest.evidence.find(
      (entry) => entry.kind === 'coverage' && entry.status === 'recorded',
    );
    const evidence =
      coverageFile?.status === 'recorded'
        ? artifactPath(journey.candidate, coverageFile.path)
        : null;

    for (const [file, lines] of changed) {
      const ranges = coverage.files.get(file);

      if (evidence === null || ranges === undefined || lines === null) {
        continue;
      }

      const ran = lines.filter((line) => within(line, ranges.executed)).length;
      const notRan = lines.filter((line) =>
        within(line, ranges.unexecuted),
      ).length;

      if (ran > 0) {
        connections.push({
          kind: 'ran-in',
          from: fileId(file),
          to: id,
          ran,
          notRan,
          evidence: [{ kind: 'artifact', path: evidence }],
        });
      }
    }
  }

  for (const finding of journey.findings) {
    if (finding.location.kind !== 'anchored') {
      continue;
    }

    const reference: MapEvidence = {
      kind: 'finding',
      journey: journey.title,
      id: finding.id,
    };

    for (const anchor of finding.location.anchors) {
      if (!changed.has(anchor.path) || anchor.basis === 'diff-name-match') {
        continue;
      }

      const artifacts = anchor.artifacts.map((item): MapEvidence => ({
        kind: 'artifact',
        path: item,
      }));

      if (finding.evidence === 'browser-errors') {
        connections.push({
          kind: 'threw-at',
          from: id,
          to: fileId(anchor.path),
          line: anchor.line,
          subject: finding.subject,
          evidence: [reference, ...artifacts],
        });
      }

      for (const check of finding.checks) {
        const verdict = journey.checks.find((item) => item.id === check);

        connections.push({
          kind: 'checked-by',
          from: fileId(anchor.path),
          to: id,
          check,
          name: verdict?.name ?? check,
          evidence: [reference, ...artifacts],
        });
      }
    }
  }

  const candidate = requestCounts(journey.candidate);
  const har = artifactPath(journey.candidate, 'requests.har');
  const baseHar = artifactPath(journey.base, 'requests.har');
  const base = baseHar === null ? null : requestCounts(journey.base);

  if (candidate !== null && har !== null) {
    const keys = new Set([...candidate.keys(), ...(base?.keys() ?? [])]);

    for (const key of keys) {
      const [method = '', ...rest] = key.split(' ');
      const route = rest.join(' ');
      const side = (counts: typeof candidate) => {
        const entry = counts.get(key);

        return {
          count: entry?.count ?? 0,
          statuses: [...(entry?.statuses ?? [])].sort((a, b) => a - b),
        };
      };

      routes.push({
        id: routeId(method, route),
        kind: 'route',
        method,
        path: route,
      });
      connections.push({
        kind: 'requested',
        from: id,
        to: routeId(method, route),
        base: base === null ? null : side(base),
        candidate: side(candidate),
        evidence: [
          { kind: 'artifact', path: har },
          ...(base === null || baseHar === null
            ? []
            : [{ kind: 'artifact', path: baseHar } as const]),
        ],
      });
    }
  }

  return { connections, routes };
}

function dedupeConnections(connections: MapConnection[]): MapConnection[] {
  const seen = new Set<string>();

  return connections.filter((connection) => {
    const key = JSON.stringify([
      connection.kind,
      connection.from,
      connection.to,
      connection.kind === 'checked-by' ? connection.check : null,
      connection.kind === 'threw-at' ? connection.line : null,
    ]);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);

    return true;
  });
}

// The map of a recorded change scope. Every connection comes from a verified
// artifact or a recorded finding; without one there is no connection.
export function changeMap({
  scope,
  journeys,
  snapshots,
}: {
  scope: ChangeScope;
  journeys: readonly MapJourney[];
  // The snapshot pair the scope compared, with the journey that captured it.
  snapshots: {
    journey: Journey;
    base: MapSnapshot;
    candidate: MapSnapshot;
  } | null;
}): ChangeMap {
  if (scope.kind === 'unavailable') {
    return scope;
  }

  if (snapshots === null) {
    return {
      kind: 'unavailable',
      reason: 'The source snapshots could not be read, so imports are unknown.',
    };
  }

  const baseImports = snapshotImports(snapshots.base);
  const candidateImports = snapshotImports(snapshots.candidate);
  const after = importEdges(candidateImports, snapshots.journey.candidate);
  const before = importEdges(baseImports, snapshots.journey.base);
  const changedPaths = new Set(
    scope.files.filter((file) => file.captured).map((file) => file.path),
  );
  const imports: MapConnection[] = [];

  for (const [key, edge] of after) {
    const kept = before.get(key);

    imports.push({
      kind: 'imports',
      from: edge.from,
      to: edge.to,
      change: kept === undefined ? 'added' : 'unchanged',
      evidence:
        kept === undefined ? [edge.evidence] : [edge.evidence, kept.evidence],
    });
  }

  for (const [key, edge] of before) {
    if (!after.has(key)) {
      imports.push({
        kind: 'imports',
        from: edge.from,
        to: edge.to,
        change: 'removed',
        evidence: [edge.evidence],
      });
    }
  }

  const touching = imports.filter(
    (edge) =>
      changedPaths.has(edge.from.slice('file:'.length)) ||
      changedPaths.has(edge.to.slice('file:'.length)),
  );
  const filePaths = new Set(changedPaths);
  const packages = new Set<string>();

  for (const edge of touching) {
    for (const end of [edge.from, edge.to]) {
      if (end.startsWith('file:')) {
        filePaths.add(end.slice('file:'.length));
      } else {
        packages.add(end.slice('package:'.length));
      }
    }
  }

  const changedLines = new Map(
    [...changedPaths].map((file) => {
      const change =
        scope.files.find((item) => item.path === file)?.change ?? 'modified';

      return [
        file,
        addedLines(
          file,
          change,
          snapshots.base.files,
          snapshots.candidate.files,
        ),
      ] as const;
    }),
  );
  const fileBlocks: MapBlock[] = [...filePaths].sort().map((file) => {
    const read = candidateImports.get(file) ?? baseImports.get(file);

    return {
      id: fileId(file),
      kind: 'file',
      path: file,
      changed: changedPaths.has(file),
      imports: blockImports(read),
    };
  });
  const outside: MapBlock[] = scope.files
    .filter((file) => !file.captured)
    .map((file) => ({
      id: fileId(file.path),
      kind: 'file',
      path: file.path,
      changed: true,
      imports: {
        kind: 'unavailable',
        reason: 'Neither source snapshot contains this file.',
      },
    }));
  const journeyBlocks: MapBlock[] = journeys.map(({ journey }, index) => ({
    id: journeyId(index),
    kind: 'journey',
    title: journey.title,
  }));
  const evidence = journeys.map((item, index) =>
    journeyConnections(item, index, changedLines),
  );
  const routes = new Map(
    evidence.flatMap((item) => item.routes).map((route) => [route.id, route]),
  );

  return {
    kind: 'recorded',
    blocks: [
      ...fileBlocks,
      ...outside,
      ...[...packages].sort().map((name): MapBlock => ({
        id: packageId(name),
        kind: 'package',
        name,
      })),
      ...journeyBlocks,
      ...routes.values(),
    ],
    connections: dedupeConnections([
      ...touching,
      ...evidence.flatMap((item) => item.connections),
    ]),
  };
}
