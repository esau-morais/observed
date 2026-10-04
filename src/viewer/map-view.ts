import { fileDetail, relationLabels } from '../change-scope-text';
import type {
  CheckVerdict,
  Comparison,
  Journey,
  MapBlock,
  MapConnection,
  ScopeFile,
} from '../comparison-model';
import {
  conclusionLabels,
  conclusionTones,
  fromRepositoryRoot,
  toneSymbols,
  type Tone,
} from '../result-text';
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
      kind: 'folded';
      fold: Fold;
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

// Groups of files that share one card until the reader opens it.
export type Fold = 'config' | 'unchanged';

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

function normalize(file: string): string {
  const out: string[] = [];

  for (const part of file.split('/')) {
    // A path above the start keeps its `..`, so it never reads as a
    // different file under the root.
    if (part === '..' && out.length > 0 && out.at(-1) !== '..') {
      out.pop();
    } else if (part !== '.' && part !== '') {
      out.push(part);
    }
  }

  return out.join('/');
}

// A path as people read it: from the repository root when the run recorded
// where the project sits, otherwise from the project.
export function repoPath(scope: RecordedScope, file: string): string {
  return normalize(fromRepositoryRoot(scope, file));
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
  // The level the map opens on.
  start: string;
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
    start: root,
  };

  // The top is the first directory that holds more than one thing.
  for (;;) {
    const level = children(index, index.root);

    if (level.length !== 1 || level[0]?.kind !== 'directory') {
      break;
    }

    index.root = level[0].path;
  }

  index.start = startLevel(index);

  return index;
}

// The map opens where the change is: the deepest directory holding at least
// three quarters of the captured changed files, so a change inside `src`
// opens on `src`'s parts rather than on one `src` block.
function startLevel(index: MapIndex): string {
  const changed = index.captured.filter((block) => index.files.has(block.path));
  const share = (directory: string) =>
    changed.filter((block) => under(block.path, directory)).length;
  let level = index.root;

  for (;;) {
    const next = children(index, level).find(
      (card) =>
        card.kind === 'directory' &&
        share(card.path) >= Math.ceil(changed.length * 0.75),
    );

    if (next?.kind !== 'directory' || changed.length === 0) {
      return level;
    }

    level = next.path;
  }
}

const directoryId = (path: string) => `directory:${path}`;

export const outsideFilesId = 'outside-files';

// Packages share one outside card; its panel lists them.
export const packagesId = 'packages';

// Requests for scripts, styles, fonts, images and the page itself share one
// card; the request view lists them. Other routes keep a card each.
export const assetsId = 'static-assets';

const staticPath =
  /\.(?:[cm]?js|css|map|woff2?|ttf|otf|eot|png|jpe?g|gif|svg|webp|avif|ico|html?)$/i;

export function isStaticRoute(path: string): boolean {
  const bare = path.split(/[?#]/)[0] ?? path;

  return bare === '/' || staticPath.test(bare);
}

const configName =
  /^(?:package\.json|bun\.lockb?|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bunfig\.toml|[tj]sconfig(?:\.[\w-]+)?\.json|deno\.jsonc?|\.npmrc|\.editorconfig|\.(?:eslintrc|prettierrc)(?:\.\w+)?|[\w-]+\.config\.[cm]?[jt]s)$/;

// Manifests, lockfiles and tool configuration, which say how the project is
// built rather than what it does.
export function isConfig(path: string): boolean {
  return configName.test(path.split('/').at(-1) ?? path);
}

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
    name: path.split('/').at(-1) ?? path,
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
    name: block.path.split('/').at(-1) ?? block.path,
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
  return [...seen.values()].sort(byKindThenId('directory'));
}

function byKindThenId(first: Card['kind']) {
  return (left: Card, right: Card) => {
    if (left.kind !== right.kind) {
      return left.kind === first ? -1 : 1;
    }

    return left.id < right.id ? -1 : Number(left.id > right.id);
  };
}

// The candidate's request count for the routes, with the base's when it
// differs: what the request ledgers recorded, not a check outcome.
function requestStatus(index: MapIndex, routes: readonly string[]): Status {
  const ids = new Set(routes);
  let candidate = 0;
  let base: number | null = 0;

  for (const connection of index.map.connections) {
    if (connection.kind === 'requested' && ids.has(connection.to)) {
      candidate += connection.candidate.count;
      base =
        base === null || connection.base === null
          ? null
          : base + connection.base.count;
    }
  }

  const label =
    base === null || base === candidate
      ? plural(candidate, 'request', 'requests')
      : `${base} → ${plural(candidate, 'request', 'requests')}`;

  return { label, tone: 'neutral', symbol: '' };
}

function journeyCards(index: MapIndex): Card[] {
  const assets = index.map.blocks.flatMap((block) =>
    block.kind === 'route' && isStaticRoute(block.path)
      ? [`${block.method} ${block.path}`]
      : [],
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
                  (check) =>
                    check.recipe?.change === 'altered' ||
                    check.recipe?.change === 'journey-altered',
                ),
                status: {
                  label:
                    conclusionLabels[journey.conclusion.kind].toLowerCase(),
                  tone: conclusionTones[journey.conclusion.kind],
                  symbol: toneSymbols[conclusionTones[journey.conclusion.kind]],
                },
              },
            ];
      }

      return [];
    }),
    ...index.map.blocks.flatMap((block): Card[] =>
      block.kind === 'route' && !isStaticRoute(block.path)
        ? [
            {
              kind: 'route',
              id: block.id,
              name: `${block.method} ${block.path}`,
              routes: [`${block.method} ${block.path}`],
              status: requestStatus(index, [block.id]),
            },
          ]
        : [],
    ),
    ...(assets.length === 0
      ? []
      : [
          {
            kind: 'route' as const,
            id: assetsId,
            name: `Static assets (${assets.length})`,
            routes: assets,
            status: requestStatus(
              index,
              index.map.blocks.flatMap((block) =>
                block.kind === 'route' && isStaticRoute(block.path)
                  ? [block.id]
                  : [],
              ),
            ),
          },
        ]),
    ...[...removed].map((title, position): Card => ({
      kind: 'removed-journey',
      id: `removed-journey:${position + 1}`,
      name: title,
      checks:
        index.result.removedJourneys.find((item) => item.journey === title)
          ?.checks ?? [],
      status: { label: 'not captured', tone: 'unknown', symbol: '?' },
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
// until the reader opens it. Two or more config files always share one.
export const crowded = 20;

export const foldId = (fold: Fold, directory: string) => `${fold}:${directory}`;

const foldNames = {
  config: (count: number) => `Config and lockfiles (${count})`,
  unchanged: (count: number) => `${count} unchanged files`,
} satisfies Record<Fold, (count: number) => string>;

export function openLevel(
  index: MapIndex,
  directory: string,
  opened: readonly Fold[] = [],
): Level {
  const all = children(index, directory);
  const groups = new Map<Fold, Card[]>();
  const config = all.filter(
    (card) => card.kind === 'file' && isConfig(card.path),
  );

  if (config.length > 1 && !opened.includes('config')) {
    groups.set('config', config);
  }

  const quiet = all.filter(
    (card) =>
      card.kind === 'file' &&
      card.file === undefined &&
      !(groups.get('config') ?? []).includes(card),
  );

  if (
    all.length > crowded &&
    quiet.length > 1 &&
    !opened.includes('unchanged')
  ) {
    groups.set('unchanged', quiet);
  }

  const folded = new Map<string, string>();
  const foldCards: Card[] = [];

  for (const [fold, cards] of groups) {
    const id = foldId(fold, directory);
    const changed = cards.flatMap((card) =>
      card.kind === 'file' && card.file !== undefined ? [card.file] : [],
    );

    for (const card of cards) {
      folded.set(card.id, id);
    }

    foldCards.push({
      kind: 'folded',
      fold,
      id,
      name: foldNames[fold](cards.length),
      paths: cards.flatMap((card) => (card.kind === 'file' ? [card.path] : [])),
      status: directoryStatus(changed),
    });
  }

  const inside: Card[] = [
    ...all.filter((card) => !folded.has(card.id)),
    ...foldCards,
  ];
  const insideIds = new Set(inside.map((card) => card.id));
  const outside = new Map<string, Card>();
  const journeys = journeyCards(index);
  const journeyIds = new Set(journeys.map((card) => card.id));
  const links = new Map<string, Link>();
  const journeyLinks = new Map<string, Link>();

  const resolve = (id: string) => {
    const block = index.blocks.get(id);

    if (block?.kind === 'route' && isStaticRoute(block.path)) {
      return { id: assetsId, place: 'journey' as const };
    }

    if (journeyIds.has(id)) {
      return { id, place: 'journey' as const };
    }

    const found = block === undefined ? null : cardFor(index, directory, block);

    if (found === null) {
      return null;
    }

    const fold = folded.get(found.card.id);

    if (fold !== undefined) {
      return { id: fold, place: 'inside' as const };
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
      : (directory.split('/').at(-1) ?? directory);

  return {
    path: directory,
    name,
    inside,
    outside: [
      ...[...outside.values()]
        .sort(byKindThenId('directory'))
        .sort(
          (left, right) =>
            Number(left.kind === 'package') - Number(right.kind === 'package'),
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
    case 'folded':
      return card.fold === 'config'
        ? `Manifests, lockfiles and tool configuration, folded into one block. ${card.status.label === 'unchanged' ? 'None changed.' : `Changed ones read ${card.status.label}.`} Open the card to place them.`
        : `${plural(card.paths.length, 'file', 'files')} the change did not touch, on the map because they import or are imported by changed files. Open the card to place them.`;
    case 'journey': {
      const checks = card.journey.checks.length;
      const redefined = card.recipe.length;

      const counted =
        checks === 0
          ? ''
          : ` ${plural(checks, 'check', 'checks')}${redefined === 0 ? '' : `, ${redefined} changed by observed.json`}.`;

      return `${card.journey.conclusion.text}${counted}`;
    }
    case 'removed-journey':
      return `Only the base's observed.json defines this journey, so nothing captured it and ${plural(card.checks.length, 'check is', 'checks are')} unknown.`;
    case 'route':
      return card.id === assetsId
        ? `${plural(card.routes.length, 'request', 'requests')} for scripts, styles, fonts, images and the page itself. The panel and each journey's request view list them.`
        : 'A route in the request ledger. Each journey link says how many requests it made, on each side.';
  }
}

export function cardPath(index: MapIndex, card: Card): string | null {
  switch (card.kind) {
    case 'directory':
      return `${repoPath(index.scope, card.path)}/`;
    case 'file':
      return repoPath(index.scope, card.path);
    case 'package':
    case 'folded':
    case 'outside-files':
    case 'journey':
    case 'removed-journey':
    case 'route':
      return null;
  }
}

export const cardKinds = {
  directory: 'directory',
  file: 'file',
  package: 'package',
  'outside-files': 'outside',
  folded: 'files',
  journey: 'journey',
  'removed-journey': 'journey',
  route: 'route',
} satisfies Record<Card['kind'], string>;

export function hasParts(card: Card): boolean {
  return card.kind === 'directory' || card.kind === 'folded';
}

function lineTotal(list: readonly (readonly [number, number])[]): number {
  return list.reduce((sum, [start, end]) => sum + end - start + 1, 0);
}

function fileFoot(block: FileBlock, file: ScopeFile | undefined): string {
  if (file === undefined) {
    return 'unchanged';
  }

  if ('lines' in file) {
    const ran = lineTotal(file.lines.ran);
    const total = ran + lineTotal(file.lines.notRan);

    return `${file.change} · ${ran} of ${total} lines ran`;
  }

  const changed = block.changedLines;

  return changed === null
    ? file.change
    : `${file.change} · ${plural(lineTotal(changed), 'line', 'lines')}`;
}

export function partsLabel(card: Card): string | null {
  switch (card.kind) {
    case 'directory':
      return `${plural(card.files, 'file', 'files')}${card.changed.length === 0 ? '' : ` · ${card.changed.length} changed`}`;
    case 'file':
      return fileFoot(card.block, card.file);
    case 'outside-files':
      return 'outside the captured source';
    case 'folded':
      return card.paths
        .map((path) => path.split('/').at(-1) ?? path)
        .join(', ');
    case 'package':
      return plural(card.packages.length, 'package', 'packages');
    case 'removed-journey':
      return plural(card.checks.length, 'check unknown', 'checks unknown');
    case 'journey':
      return card.recipe.length === 0
        ? plural(card.journey.checks.length, 'check', 'checks')
        : `${plural(card.recipe.length, 'check', 'checks')} redefined`;
    case 'route':
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
// files they reach (downstream), with how many hops away the farthest is.
export function reach(
  index: MapIndex,
  card: Card,
): { upstream: Reach; downstream: Reach } | null {
  let seeds: string[] = [];

  if (card.kind === 'file') {
    seeds = [card.block.id];
  } else if (card.kind === 'directory') {
    seeds = index.captured
      .filter((block) => under(block.path, card.path))
      .map((block) => block.id);
  }

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
