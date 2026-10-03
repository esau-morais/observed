import {
  fileDetail,
  relationLabels,
  scopeFileLines,
} from '../change-scope-text';
import type {
  ChangeMap,
  ChangeScope,
  Comparison,
  MapBlock,
  MapConnection,
  ScopeFile,
} from '../comparison-model';
import type { Tone } from '../result-text';

export type RecordedMap = Extract<ChangeMap, { kind: 'recorded' }>;

export type RecordedScope = Extract<ChangeScope, { kind: 'recorded' }>;

// A relation is never shown as a passing check: only "checked" uses the
// checked tone, and its label names the relation, not a check outcome.
const relationChips = {
  checked: { tone: 'checked', symbol: '✓' },
  exercised: { tone: 'neutral', symbol: '▸' },
  'not-observed': { tone: 'unknown', symbol: '?' },
  'outside-captured-source': { tone: 'unknown', symbol: '∅' },
} as const satisfies Record<
  ScopeFile['relation'],
  { tone: Tone; symbol: string }
>;

export type Chip = { label: string; tone: Tone; symbol: string };

export function relationChip(relation: ScopeFile['relation']): Chip {
  return { label: relationLabels[relation], ...relationChips[relation] };
}

export const connectionKinds = [
  'imports',
  'ran-in',
  'requested',
  'threw-at',
  'checked-by',
] as const satisfies readonly MapConnection['kind'][];

export const connectionLabels = {
  imports: 'Imports',
  'ran-in': 'Ran in',
  requested: 'Requested',
  'threw-at': 'Threw at',
  'checked-by': 'Checked by',
} satisfies Record<MapConnection['kind'], string>;

export const connectionSources = {
  imports: 'The static import graph of each snapshot',
  'ran-in': 'Execution coverage of the changed lines',
  requested: 'The request ledger of each side',
  'threw-at': 'An error record and its stack frame',
  'checked-by': 'A named check and its scope',
} satisfies Record<MapConnection['kind'], string>;

export function blockName(block: MapBlock): string {
  switch (block.kind) {
    case 'file':
      return block.path.split('/').at(-1) ?? block.path;
    case 'package':
      return block.name;
    case 'journey':
      return block.title;
    case 'route':
      return `${block.method} ${block.path}`;
  }
}

export function blockTitle(block: MapBlock): string {
  return block.kind === 'file' ? block.path : blockName(block);
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function connectionText(
  connection: MapConnection,
  blocks: ReadonlyMap<string, MapBlock>,
): string {
  const from = blocks.get(connection.from);
  const to = blocks.get(connection.to);
  const name = (block: MapBlock | undefined) =>
    block === undefined ? 'an unknown block' : blockTitle(block);

  switch (connection.kind) {
    case 'imports': {
      const change = {
        unchanged: '',
        added: '. The change added this import',
        removed: '. The change removed this import',
      }[connection.change];

      return `${name(from)} imports ${name(to)}${change}`;
    }
    case 'ran-in':
      return `${plural(connection.ran, 'changed line', 'changed lines')} of ${name(from)} ran in ${name(to)}, and ${connection.notRan} did not`;
    case 'requested': {
      const base =
        connection.base === null
          ? 'base unknown'
          : `base ${connection.base.count}`;
      const statuses = connection.candidate.statuses.join(', ');

      return `${name(to)}: ${plural(connection.candidate.count, 'request', 'requests')}, ${base}${statuses === '' ? '' : `. Status ${statuses}`}`;
    }
    case 'threw-at':
      return `${connection.subject} at ${name(to)}:${connection.line}`;
    case 'checked-by':
      return `${name(from)} checked by ${connection.name} in ${name(to)}`;
  }
}

export function scopeFiles(scope: RecordedScope): Map<string, ScopeFile> {
  return new Map(scope.files.map((file) => [file.path, file]));
}

export type TableRow = {
  path: string;
  change: ScopeFile['change'];
  chip: Chip;
  detail: string;
};

// The map's text version: one row per changed file with the same facts the
// map's chips show, then the scope's notes.
export function scopeTable(result: Comparison): {
  rows: TableRow[];
  notes: string[];
} {
  const scope = result.changeScope;

  if (scope.kind === 'unavailable') {
    return { rows: [], notes: [] };
  }

  return {
    rows: scope.files.map((file) => ({
      path: file.path,
      change: file.change,
      chip: relationChip(file.relation),
      detail: fileDetail(result, file),
    })),
    notes: scopeFileLines(result).slice(scope.files.length),
  };
}

export function directoryOf(file: string): string {
  const index = file.lastIndexOf('/');

  return index === -1 ? '' : file.slice(0, index);
}

export function parentDirectory(directory: string): string {
  return directoryOf(directory);
}

function within(file: string, directory: string): boolean {
  return directory === '' || file.startsWith(`${directory}/`);
}

// The deepest directory that holds every file block.
export function commonDirectory(map: RecordedMap): string {
  const directories = map.blocks.flatMap((block) =>
    block.kind === 'file' ? [directoryOf(block.path)] : [],
  );
  const [first, ...rest] = directories;

  if (first === undefined) {
    return '';
  }

  let common = first;

  for (const directory of rest) {
    while (common !== '' && !within(`${directory}/x`, common)) {
      common = parentDirectory(common);
    }
  }

  return common;
}

export type DirectoryNode = {
  path: string;
  name: string;
  files: Extract<MapBlock, { kind: 'file' }>[];
  directories: DirectoryNode[];
};

export type VisibleMap = {
  tree: DirectoryNode;
  packages: Extract<MapBlock, { kind: 'package' }>[];
  journeys: Extract<MapBlock, { kind: 'journey' | 'route' }>[];
  connections: MapConnection[];
  hidden: number;
};

function insert(
  node: DirectoryNode,
  relative: string[],
  file: DirectoryNode['files'][number],
) {
  const [head, ...rest] = relative;

  if (head === undefined || rest.length === 0) {
    node.files.push(file);

    return;
  }

  const childPath = node.path === '' ? head : `${node.path}/${head}`;
  let child = node.directories.find((item) => item.path === childPath);

  if (child === undefined) {
    child = { path: childPath, name: head, files: [], directories: [] };
    node.directories.push(child);
  }

  insert(child, rest, file);
}

// The blocks under `directory`, nested by directory, with the packages and
// journeys they connect to. Connections to blocks outside the directory are
// counted in `hidden`.
export function visibleMap(map: RecordedMap, directory: string): VisibleMap {
  const tree: DirectoryNode = {
    path: directory,
    name: directory === '' ? '.' : (directory.split('/').at(-1) ?? directory),
    files: [],
    directories: [],
  };
  const shown = new Set<string>();

  for (const block of map.blocks) {
    if (block.kind === 'file' && within(block.path, directory)) {
      const relative =
        directory === '' ? block.path : block.path.slice(directory.length + 1);

      insert(tree, relative.split('/'), block);
      shown.add(block.id);
    }
  }

  const connected = (block: MapBlock) =>
    map.connections.some(
      (connection) =>
        (connection.from === block.id && shown.has(connection.to)) ||
        (connection.to === block.id && shown.has(connection.from)),
    );
  const packages = map.blocks.filter(
    (block): block is VisibleMap['packages'][number] =>
      block.kind === 'package' && connected(block),
  );
  const journeys = map.blocks.filter(
    (block): block is VisibleMap['journeys'][number] =>
      block.kind === 'journey' || block.kind === 'route',
  );

  for (const block of [...packages, ...journeys]) {
    shown.add(block.id);
  }

  const connections = map.connections.filter(
    (connection) => shown.has(connection.from) && shown.has(connection.to),
  );

  return {
    tree,
    packages,
    journeys,
    connections,
    hidden: map.connections.length - connections.length,
  };
}

// Blocks that share a connection with `id`, and `id` itself. Pointing at a
// block dims every other block.
export function related(map: RecordedMap, id: string): Set<string> {
  const ids = new Set([id]);

  for (const connection of map.connections) {
    if (connection.from === id) {
      ids.add(connection.to);
    } else if (connection.to === id) {
      ids.add(connection.from);
    }
  }

  return ids;
}

// Journey connections show only when one of their ends is pointed at or
// selected.
export function isJourneyConnection(connection: MapConnection): boolean {
  return connection.kind !== 'imports';
}

// The failed and unknown checks the side panel opens on.
export function verdictChecks(result: Comparison) {
  return result.journeys.flatMap((journey, index) =>
    journey.checks
      .filter(
        (check) => check.verdict !== 'passed' && check.verdict !== 'not-run',
      )
      .map((check) => ({ journey, index, check })),
  );
}

// The short label drawn on a connection: its count or its evidence in a few
// words.
export function connectionShort(connection: MapConnection): string {
  switch (connection.kind) {
    case 'imports':
      return connection.change === 'unchanged' ? '' : connection.change;
    case 'ran-in':
      return `${connection.ran} ran, ${connection.notRan} not`;
    case 'requested':
      return `${plural(connection.candidate.count, 'request', 'requests')}, base ${connection.base === null ? 'unknown' : connection.base.count}`;
    case 'threw-at':
      return `line ${connection.line}`;
    case 'checked-by':
      return connection.name;
  }
}
