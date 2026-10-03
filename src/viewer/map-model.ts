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
