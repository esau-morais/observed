import { fileDetail, relationLabels } from '../change-scope-text';
import type {
  CheckVerdict,
  Comparison,
  Journey,
  MapBlock,
  MapConnection,
  ScopeFile,
} from '../comparison-model';
import { conclusionLabels, conclusionTones, type Tone } from '../result-text';
import type { RecordedMap, RecordedScope } from './map-model';

export type Status = {
  label: string;
  // The label a card has room for, when it differs.
  short?: string;
  tone: Tone;
  symbol: string;
};

type FileBlock = Extract<MapBlock, { kind: 'file' }>;

export type Card =
  | {
      kind: 'directory';
      id: string;
      path: string;
      name: string;
      files: number;
      changed: ScopeFile[];
      status: Status;
    }
  | {
      kind: 'file';
      id: string;
      path: string;
      name: string;
      block: FileBlock;
      file: ScopeFile | undefined;
      status: Status;
    }
  | {
      kind: 'package';
      id: string;
      name: string;
      packages: string[];
      status: Status;
    }
  | {
      kind: 'unchanged-files';
      id: string;
      name: string;
      paths: string[];
      status: Status;
    }
  | {
      kind: 'outside-files';
      id: string;
      name: string;
      files: ScopeFile[];
      status: Status;
    }
  | {
      kind: 'journey';
      id: string;
      name: string;
      journey: Journey;
      recipe: CheckVerdict[];
      status: Status;
    }
  | {
      kind: 'removed-journey';
      id: string;
      name: string;
      checks: readonly CheckVerdict[];
      status: Status;
    }
  | {
      kind: 'route';
      id: string;
      name: string;
      routes: string[];
      status: Status;
    };

export type Link = {
  id: string;
  kind: MapConnection['kind'];
  from: string;
  to: string;
  connections: MapConnection[];
  removed: boolean;
};

export type Level = {
  path: string;
  name: string;
  inside: Card[];
  outside: Card[];
  journeys: Card[];
  // Links between inside and outside cards, always drawn.
  links: Link[];
  // Links that touch a journey or route, drawn on hover or selection.
  journeyLinks: Link[];
};

const relationStatus = {
  checked: { tone: 'checked', symbol: '✓' },
  exercised: { tone: 'neutral', symbol: '▸' },
  'not-observed': { tone: 'unknown', symbol: '?' },
  'outside-captured-source': { tone: 'unknown', symbol: '∅' },
} as const satisfies Record<
  ScopeFile['relation'],
  { tone: Tone; symbol: string }
>;

export function statusOf(relation: ScopeFile['relation']): Status {
  return {
    label: relationLabels[relation].toLowerCase(),
    ...(relation === 'outside-captured-source' ? { short: 'outside' } : {}),
    ...relationStatus[relation],
  };
}

const unchanged: Status = { label: 'unchanged', tone: 'neutral', symbol: '–' };

// A directory reads as its weakest changed file, so a gap is never hidden
// behind a checked sibling.
const weakest = ['not-observed', 'exercised', 'checked'] as const;

function directoryStatus(changed: readonly ScopeFile[]): Status {
  const relation = weakest.find((item) =>
    changed.some((file) => file.relation === item),
  );

  return relation === undefined ? unchanged : statusOf(relation);
}

const words: Record<string, string> = {
  src: 'Source',
  lib: 'Library',
  libs: 'Libraries',
  pkg: 'Package',
  utils: 'Utilities',
  api: 'API',
  ui: 'UI',
  css: 'CSS',
  html: 'HTML',
  json: 'JSON',
  cli: 'CLI',
  url: 'URL',
  id: 'ID',
  ci: 'CI',
};

// A readable name from a path segment: `change-map.tsx` is "Change map",
// `src` is "Source". The path itself stays in the card and panel.
export function humanName(segment: string, file = false): string {
  if (file && !/\.[cm]?[jt]sx?$/.test(segment)) {
    return segment;
  }

  const bare = segment
    .replace(/^\.+/, '')
    .replace(/\.(d\.)?[cm]?[jt]sx?$|\.[a-z0-9]+$/i, '');
  const parts = bare
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[-_.\s]+/)
    .filter((part) => part !== '');

  if (parts.length === 0) {
    return segment;
  }

  return parts
    .map((part, index) => {
      const known = words[part.toLowerCase()];

      if (known !== undefined) {
        return known;
      }

      const lower = part.toLowerCase();

      return index === 0
        ? lower.charAt(0).toUpperCase() + lower.slice(1)
        : lower;
    })
    .join(' ');
}

function normalize(file: string): string {
  const out: string[] = [];

  for (const part of file.split('/')) {
    if (part === '..') {
      out.pop();
    } else if (part !== '.' && part !== '') {
      out.push(part);
    }
  }

  return out.join('/');
}

// The project's directory under the repository root, when the scope recorded
// it (result schema 9), so paths read from the root instead of `../../`.
export function projectDirectory(scope: RecordedScope): string {
  const outside: object = scope.outside;

  return 'projectDirectory' in outside &&
    typeof outside.projectDirectory === 'string' &&
    outside.projectDirectory !== '.'
    ? outside.projectDirectory
    : '';
}

export function repoPath(scope: RecordedScope, file: string): string {
  const base = projectDirectory(scope);

  return normalize(base === '' ? file : `${base}/${file}`);
}

function parent(directory: string): string {
  const index = directory.lastIndexOf('/');

  return index === -1 ? '' : directory.slice(0, index);
}

function under(file: string, directory: string): boolean {
  return directory === '' || file.startsWith(`${directory}/`);
}

export type MapIndex = {
  map: RecordedMap;
  scope: RecordedScope;
  result: Comparison;
  blocks: Map<string, MapBlock>;
  files: Map<string, ScopeFile>;
  captured: FileBlock[];
  outsideFiles: ScopeFile[];
  root: string;
};

export function indexMap(
  result: Comparison,
  map: RecordedMap,
  scope: RecordedScope,
): MapIndex {
  const files = new Map(scope.files.map((file) => [file.path, file]));
  const captured = map.blocks.filter(
    (block): block is FileBlock =>
      block.kind === 'file' && files.get(block.path)?.captured !== false,
  );
  const outsideFiles = scope.files.filter((file) => !file.captured);
  const directories = captured.map((block) => parent(block.path));
  let root = directories[0] ?? '';

  for (const directory of directories) {
    while (root !== '' && !under(`${directory}/x`, root)) {
      root = parent(root);
    }
  }

  const index: MapIndex = {
    map,
    scope,
    result,
    blocks: new Map(map.blocks.map((block) => [block.id, block])),
    files,
    captured,
    outsideFiles,
    root,
  };

  // Open the first directory that holds more than one thing.
  for (;;) {
    const level = children(index, index.root);

    if (level.length !== 1 || level[0]?.kind !== 'directory') {
      return index;
    }

    index.root = level[0].path;
  }
}

const directoryId = (path: string) => `directory:${path}`;

export const outsideFilesId = 'outside-files';

// Packages share one outside card; its panel lists them.
export const packagesId = 'packages';

// Routes share one journey-row card; its panel lists them.
export const routesId = 'routes';

export function directoryCard(index: MapIndex, path: string): Card {
  const inside = index.captured.filter((block) => under(block.path, path));
  const changed = inside.flatMap((block) => {
    const file = index.files.get(block.path);

    return file === undefined ? [] : [file];
  });

  return {
    kind: 'directory',
    id: directoryId(path),
    path,
    name: humanName(path.split('/').at(-1) ?? path),
    files: inside.length,
    changed,
    status: directoryStatus(changed),
  };
}

function fileCard(index: MapIndex, block: FileBlock): Card {
  const file = index.files.get(block.path);

  return {
    kind: 'file',
    id: block.id,
    path: block.path,
    name: humanName(block.path.split('/').at(-1) ?? block.path, true),
    block,
    file,
    status: file === undefined ? unchanged : statusOf(file.relation),
  };
}

// The directories and files directly under `directory`.
export function children(index: MapIndex, directory: string): Card[] {
  const seen = new Map<string, Card>();

  for (const block of index.captured) {
    if (!under(block.path, directory)) {
      continue;
    }

    const rest =
      directory === '' ? block.path : block.path.slice(directory.length + 1);
    const [head, ...tail] = rest.split('/');

    if (head === undefined) {
      continue;
    }

    if (tail.length === 0) {
      seen.set(block.id, fileCard(index, block));
    } else {
      const path = directory === '' ? head : `${directory}/${head}`;

      if (!seen.has(directoryId(path))) {
        seen.set(directoryId(path), directoryCard(index, path));
      }
    }
  }

  // Directories first, then files, each by name, so reading order is stable.
  return [...seen.values()].sort((left, right) =>
    left.kind === right.kind
      ? left.id < right.id
        ? -1
        : Number(left.id > right.id)
      : left.kind === 'directory'
        ? -1
        : 1,
  );
}

function journeyCards(index: MapIndex): Card[] {
  const routes = index.map.blocks.flatMap((block) =>
    block.kind === 'route' ? [`${block.method} ${block.path}`] : [],
  );
  const removed = new Set(
    index.result.removedJourneys.map((journey) => journey.journey),
  );

  return [
    ...index.map.blocks.flatMap((block): Card[] => {
      if (block.kind === 'journey') {
        const position = Number(block.id.slice('journey:'.length)) - 1;
        const journey = index.result.journeys[position];

        return journey === undefined
          ? []
          : [
              {
                kind: 'journey',
                id: block.id,
                name: block.title,
                journey,
                recipe: journey.checks.filter(
                  (check) => check.recipe !== undefined,
                ),
                status: {
                  label:
                    conclusionLabels[journey.conclusion.kind].toLowerCase(),
                  tone: conclusionTones[journey.conclusion.kind],
                  symbol: '',
                },
              },
            ];
      }

      return [];
    }),
    ...(routes.length === 0
      ? []
      : [
          {
            kind: 'route' as const,
            id: routesId,
            name: 'Requested routes',
            routes,
            status: {
              label: `${routes.length} ${routes.length === 1 ? 'route' : 'routes'}`,
              tone: 'neutral' as const,
              symbol: '',
            },
          },
        ]),
    ...[...removed].map((title, position): Card => ({
      kind: 'removed-journey',
      id: `removed-journey:${position + 1}`,
      name: title,
      checks:
        index.result.removedJourneys.find((item) => item.journey === title)
          ?.checks ?? [],
      status: { label: 'removed', tone: 'unknown', symbol: '?' },
    })),
  ];
}

// The card a block appears as when `directory` is open: a child of the
// directory, or, for a block elsewhere, the outermost directory or file that
// holds it without holding the open directory.
function cardFor(
  index: MapIndex,
  directory: string,
  block: MapBlock,
): { card: Card; place: 'inside' | 'outside' | 'journey' } | null {
  switch (block.kind) {
    case 'package':
      return {
        card: {
          kind: 'package',
          id: packagesId,
          name: 'Packages',
          packages: [block.name],
          status: statusOf('outside-captured-source'),
        },
        place: 'outside',
      };
    case 'journey':
    case 'route':
      return null;
    case 'file': {
      if (index.files.get(block.path)?.captured === false) {
        return null;
      }

      if (under(block.path, directory)) {
        const rest =
          directory === ''
            ? block.path
            : block.path.slice(directory.length + 1);
        const [head, ...tail] = rest.split('/');
        const path =
          directory === '' ? (head ?? '') : `${directory}/${head ?? ''}`;

        return {
          card:
            tail.length === 0
              ? fileCard(index, block)
              : directoryCard(index, path),
          place: 'inside',
        };
      }

      let shared = directory;

      while (shared !== '' && !under(block.path, shared)) {
        shared = parent(shared);
      }

      const rest =
        shared === '' ? block.path : block.path.slice(shared.length + 1);
      const [head, ...tail] = rest.split('/');
      const path = shared === '' ? (head ?? '') : `${shared}/${head ?? ''}`;

      return {
        card:
          tail.length === 0
            ? fileCard(index, block)
            : directoryCard(index, path),
        place: 'outside',
      };
    }
  }
}

// A level with more blocks than this folds its unchanged files into one card
// until the reader opens it, as Nx folds a directory and CodeSee hides
// unchanged files.
export const crowded = 20;

export const unchangedId = (directory: string) => `unchanged:${directory}`;

export function openLevel(
  index: MapIndex,
  directory: string,
  showUnchanged = false,
): Level {
  const all = children(index, directory);
  const quiet = all.filter(
    (card) => card.kind === 'file' && card.file === undefined,
  );
  const fold = !showUnchanged && all.length > crowded && quiet.length > 1;
  const folded = new Set(fold ? quiet.map((card) => card.id) : []);
  const inside: Card[] = fold
    ? [
        ...all.filter((card) => !folded.has(card.id)),
        {
          kind: 'unchanged-files',
          id: unchangedId(directory),
          name: `${quiet.length} unchanged files`,
          paths: quiet.flatMap((card) => (card.kind === 'file' ? [card.path] : [])),
          status: unchanged,
        },
      ]
    : all;
  const insideIds = new Set(inside.map((card) => card.id));
  const outside = new Map<string, Card>();
  const journeys = journeyCards(index);
  const journeyIds = new Set(journeys.map((card) => card.id));
  const links = new Map<string, Link>();
  const journeyLinks = new Map<string, Link>();

  const resolve = (id: string) => {
    const block = index.blocks.get(id);

    if (block?.kind === 'route') {
      return { id: routesId, place: 'journey' as const };
    }

    if (journeyIds.has(id)) {
      return { id, place: 'journey' as const };
    }

    const found = block === undefined ? null : cardFor(index, directory, block);

    if (found === null) {
      return null;
    }

    if (folded.has(found.card.id)) {
      return { id: unchangedId(directory), place: 'inside' as const };
    }

    return { id: found.card.id, place: found.place, card: found.card };
  };

  for (const connection of index.map.connections) {
    const from = resolve(connection.from);
    const to = resolve(connection.to);

    if (from === null || to === null || from.id === to.id) {
      continue;
    }

    const touchesInside = insideIds.has(from.id) || insideIds.has(to.id);
    const journey = from.place === 'journey' || to.place === 'journey';

    // Outside cards appear only for what they share with the open level.
    if (
      !touchesInside &&
      !(journey && from.place !== 'outside' && to.place !== 'outside')
    ) {
      continue;
    }

    for (const end of [from, to]) {
      if (end.place === 'outside' && 'card' in end && end.card !== undefined) {
        const known = outside.get(end.id);

        if (known?.kind === 'package' && end.card.kind === 'package') {
          for (const name of end.card.packages) {
            if (!known.packages.includes(name)) {
              known.packages.push(name);
            }
          }
        } else if (known === undefined) {
          outside.set(end.id, end.card);
        }
      }
    }

    const removed =
      connection.kind === 'imports' && connection.change === 'removed';
    const key = `${connection.kind}${removed ? ':removed' : ''}\u0000${from.id}\u0000${to.id}`;
    const target = journey ? journeyLinks : links;
    const link = target.get(key) ?? {
      id: key,
      kind: connection.kind,
      from: from.id,
      to: to.id,
      connections: [],
      removed,
    };

    link.connections.push(connection);
    target.set(key, link);
  }

  const name =
    directory === index.root
      ? index.result.title
      : humanName(directory.split('/').at(-1) ?? directory);

  return {
    path: directory,
    name,
    inside,
    outside: [
      ...[...outside.values()].sort((left, right) =>
        left.kind === right.kind
          ? left.id < right.id
            ? -1
            : Number(left.id > right.id)
          : left.kind === 'package'
            ? 1
            : -1,
      ),
      ...(directory === index.root && index.outsideFiles.length > 0
        ? [
            {
              kind: 'outside-files' as const,
              id: outsideFilesId,
              name: `${index.outsideFiles.length} ${index.outsideFiles.length === 1 ? 'file' : 'files'}`,
              files: index.outsideFiles,
              status: statusOf('outside-captured-source'),
            },
          ]
        : []),
    ],
    journeys,
    links: [...links.values()],
    journeyLinks: [...journeyLinks.values()],
  };
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

// One plain sentence per card, built from recorded facts only.
export function cardSentence(index: MapIndex, card: Card): string {
  switch (card.kind) {
    case 'directory': {
      const counts = weakest
        .map(
          (relation) =>
            [
              relation,
              card.changed.filter((file) => file.relation === relation).length,
            ] as const,
        )
        .filter(([, count]) => count > 0)
        .map(
          ([relation, count]) =>
            `${count} ${relationLabels[relation].toLowerCase()}`,
        );

      return card.changed.length === 0
        ? `${plural(card.files, 'file', 'files')} on the map, none changed.`
        : `${plural(card.files, 'file', 'files')} on the map, ${card.changed.length} changed: ${counts.join(', ')}.`;
    }
    case 'file':
      return card.file === undefined
        ? 'Unchanged. On the map because it imports or is imported by a changed file.'
        : `${card.file.change.charAt(0).toUpperCase()}${card.file.change.slice(1)}. ${fileDetail(index.result, card.file)}`;
    case 'package':
      return `${plural(card.packages.length, 'package', 'packages')} outside the captured source, imported from this level.`;
    case 'outside-files':
      return `${plural(card.files.length, 'file', 'files')} changed outside the captured source. No capture holds them, so no evidence can touch them.`;
    case 'unchanged-files':
      return `${plural(card.paths.length, 'file', 'files')} the change did not touch, on the map because they import or are imported by changed files. Open the card to place them.`;
    case 'journey': {
      const checks = card.journey.checks.length;
      const redefined = card.recipe.length;

      return `${card.journey.conclusion.text}${checks === 0 ? '' : ` ${plural(checks, 'check', 'checks')}.`}${redefined === 0 ? '' : ` observed.json changed ${plural(redefined, 'check', 'checks')} here.`}`;
    }
    case 'removed-journey':
      return `Only the base's observed.json defines this journey, so nothing captured it and ${plural(card.checks.length, 'check is', 'checks are')} unknown.`;
    case 'route':
      return `${plural(card.routes.length, 'route', 'routes')} in the request ledgers. Each journey's links show which it requested.`;
  }
}

export function cardPath(index: MapIndex, card: Card): string | null {
  switch (card.kind) {
    case 'directory':
      return `${repoPath(index.scope, card.path)}/`;
    case 'file':
      return repoPath(index.scope, card.path);
    default:
      return null;
  }
}

export const cardKinds = {
  directory: 'directory',
  file: 'file',
  package: 'package',
  'outside-files': 'outside',
  'unchanged-files': 'files',
  journey: 'journey',
  'removed-journey': 'journey',
  route: 'route',
} satisfies Record<Card['kind'], string>;

export function hasParts(card: Card): boolean {
  return card.kind === 'directory' || card.kind === 'unchanged-files';
}

export function partsLabel(card: Card): string | null {
  switch (card.kind) {
    case 'directory':
      return `${plural(card.files, 'file', 'files')}${card.changed.length === 0 ? '' : ` · ${card.changed.length} changed`}`;
    case 'file':
      return card.path.split('/').at(-1) ?? card.path;
    case 'outside-files':
      return 'outside the captured source';
    case 'unchanged-files':
      return 'folded · opens in place';
    case 'package':
      return plural(card.packages.length, 'package', 'packages');
    case 'removed-journey':
      return plural(card.checks.length, 'check unknown', 'checks unknown');
    case 'journey':
      return card.recipe.length === 0
        ? plural(card.journey.checks.length, 'check', 'checks')
        : `${plural(card.recipe.length, 'check', 'checks')} redefined`;
    default:
      return null;
  }
}

export function levelTrail(index: MapIndex, directory: string): string[] {
  const trail = [directory];

  while (trail[0] !== index.root && trail[0] !== '') {
    trail.unshift(parent(trail[0] ?? ''));
  }

  return trail;
}

export function parentLevel(index: MapIndex, directory: string): string | null {
  return directory === index.root ? null : parent(directory);
}

export type Reach = { files: number; hops: number };

// Files that reach the card's files through recorded imports (upstream) and
// files they reach (downstream), with the longest chain in hops.
export function reach(
  index: MapIndex,
  card: Card,
): { upstream: Reach; downstream: Reach } | null {
  const seeds =
    card.kind === 'file'
      ? [card.block.id]
      : card.kind === 'directory'
        ? index.captured
            .filter((block) => under(block.path, card.path))
            .map((block) => block.id)
        : [];

  if (seeds.length === 0) {
    return null;
  }

  const walk = (direction: 'up' | 'down'): Reach => {
    const next = new Map<string, string[]>();

    for (const connection of index.map.connections) {
      if (connection.kind !== 'imports' || connection.change === 'removed') {
        continue;
      }

      const [from, to] =
        direction === 'down'
          ? [connection.from, connection.to]
          : [connection.to, connection.from];

      next.set(from, [...(next.get(from) ?? []), to]);
    }

    const start = new Set(seeds);
    const seen = new Set(seeds);
    let frontier = seeds;
    let hops = 0;

    while (frontier.length > 0) {
      const following = frontier.flatMap((id) =>
        (next.get(id) ?? []).filter((other) => !seen.has(other)),
      );

      for (const id of following) {
        seen.add(id);
      }

      if (following.length > 0) {
        hops += 1;
      }

      frontier = [...new Set(following)];
    }

    return {
      files: [...seen].filter(
        (id) => !start.has(id) && index.blocks.get(id)?.kind === 'file',
      ).length,
      hops,
    };
  };

  return { upstream: walk('up'), downstream: walk('down') };
}
