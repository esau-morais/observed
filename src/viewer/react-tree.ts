import {
  renderChanges,
  type ReactEvidence,
  type RenderChange,
} from '../evidence-kinds/react';

export type RenderChangeKind = 'more' | 'fewer' | 'same' | 'unknown';

// Rendered during steps, kept in the subtree only as an ancestor of a
// rendered component, not in that side's recorded subtree, or missing from a
// subtree that reached its recording limit, where absence proves nothing.
export type NodeState = 'rendered' | 'ancestor' | 'absent' | 'unrecorded';

export type TreeNode = {
  readonly key: string;
  readonly name: string;
  readonly depth: number;
  // Null when that side has no recording.
  readonly state: {
    readonly base: NodeState | null;
    readonly candidate: NodeState | null;
  };
  readonly renders: {
    readonly base: number | null;
    readonly candidate: number | null;
  };
  readonly change: RenderChangeKind;
  readonly children: readonly TreeNode[];
  // Nodes in this subtree, itself included, whose counts or presence differ.
  readonly notable: number;
  readonly size: number;
};

export type RenderTree = {
  readonly roots: readonly TreeNode[];
  readonly comparing: boolean;
  // Components whose counts changed but that neither recorded subtree holds,
  // such as one that unmounted during the steps.
  readonly outside: readonly RenderChange[];
  // Distinct component names whose counts or presence differ.
  readonly changedNames: number;
};

// As renderChanges counts: a name absent from a recording that did not reach
// its component limit rendered zero times there.
function renderTotal(value: ReactEvidence, name: string): number | null {
  const entry = value.components.find((item) => item.name === name);

  if (entry !== undefined) {
    return entry.mounts + entry.updates;
  }

  return value.truncated.components ? null : 0;
}

type Draft = {
  name: string;
  depth: number;
  rendered: boolean;
  children: Draft[];
  key: string;
};

function draftTree(value: ReactEvidence): Draft[] {
  const roots: Draft[] = [];
  const stack: Draft[] = [];

  for (const entry of value.subtree) {
    while (stack.length > entry.depth) {
      stack.pop();
    }

    const parent = stack.at(-1);
    const siblings = parent?.children ?? roots;
    const nth = siblings.filter((node) => node.name === entry.name).length;
    const node: Draft = {
      name: entry.name,
      depth: stack.length,
      rendered: entry.rendered,
      children: [],
      key: `${parent?.key ?? ''}/${entry.name}#${nth}`,
    };

    siblings.push(node);
    stack.push(node);
  }

  return roots;
}

function changeOf(base: number | null, candidate: number | null) {
  if (base === null || candidate === null) {
    return 'unknown';
  }

  if (candidate === base) {
    return 'same';
  }

  return candidate > base ? 'more' : 'fewer';
}

type Pair = { name: string; key: string; base?: Draft; candidate?: Draft };

function merge(base: readonly Draft[], candidate: readonly Draft[]): Pair[] {
  const byKey = new Map<string, Pair>();

  for (const node of candidate) {
    byKey.set(node.key, { name: node.name, key: node.key, candidate: node });
  }

  for (const node of base) {
    const entry = byKey.get(node.key);

    if (entry === undefined) {
      byKey.set(node.key, { name: node.name, key: node.key, base: node });
    } else {
      entry.base = node;
    }
  }

  return [...byKey.values()];
}

// Base and candidate subtrees merged by position: a node matches the node
// with the same name, parent and position among same-name siblings. Render
// counts are per component name, so instances that share a name show the
// same totals.
export function renderTree(
  base: ReactEvidence | null,
  candidate: ReactEvidence | null,
): RenderTree {
  const comparing = base !== null && candidate !== null;
  const count = (value: ReactEvidence | null, name: string) =>
    value === null ? null : renderTotal(value, name);

  const build = (
    before: readonly Draft[],
    after: readonly Draft[],
  ): TreeNode[] =>
    merge(before, after).map((entry) => {
      const children = build(
        entry.base?.children ?? [],
        entry.candidate?.children ?? [],
      );
      const renders = {
        base: count(base, entry.name),
        candidate: count(candidate, entry.name),
      };
      const change = comparing
        ? changeOf(renders.base, renders.candidate)
        : 'same';
      const stateOf = (
        value: ReactEvidence | null,
        draft?: Draft,
      ): NodeState | null => {
        if (value === null) {
          return null;
        }

        if (draft === undefined) {
          return value.truncated.subtree ? 'unrecorded' : 'absent';
        }

        return draft.rendered ? 'rendered' : 'ancestor';
      };

      const state = {
        base: stateOf(base, entry.base),
        candidate: stateOf(candidate, entry.candidate),
      };
      const own =
        comparing &&
        (change === 'more' || change === 'fewer' || oneSided(state) !== null);

      return {
        key: entry.key,
        name: entry.name,
        depth: (entry.candidate ?? entry.base)?.depth ?? 0,
        state,
        renders,
        change,
        children,
        notable:
          (own ? 1 : 0) +
          children.reduce((sum, child) => sum + child.notable, 0),
        size: 1 + children.reduce((sum, child) => sum + child.size, 0),
      };
    });

  const roots = build(
    base === null ? [] : draftTree(base),
    candidate === null ? [] : draftTree(candidate),
  );
  const names = new Set<string>();
  const changed = new Set<string>();
  const collect = (nodes: readonly TreeNode[]) =>
    nodes.forEach((node) => {
      names.add(node.name);

      if (changedNode(node)) {
        changed.add(node.name);
      }

      collect(node.children);
    });

  collect(roots);

  const outside = comparing
    ? renderChanges(base, candidate).filter((change) => !names.has(change.name))
    : [];

  return {
    roots,
    comparing,
    outside,
    changedNames: comparing ? changed.size + outside.length : 0,
  };
}

export type TreeRow =
  | {
      readonly kind: 'node';
      readonly key: string;
      readonly node: TreeNode;
      readonly depth: number;
      readonly guides: string;
      readonly connector: string;
      readonly ancestors: readonly number[];
      // Index of the last row in this node's subtree.
      readonly end: number;
    }
  | {
      readonly kind: 'fold';
      readonly key: string;
      readonly nodes: readonly TreeNode[];
      readonly size: number;
      readonly depth: number;
      readonly guides: string;
      readonly connector: string;
      readonly ancestors: readonly number[];
      readonly end: number;
    };

// The side whose recorded tree alone holds the node, when the other side's
// tree is complete enough to show the absence.
export function oneSided(
  state: TreeNode['state'],
): 'base' | 'candidate' | null {
  const present = (value: NodeState | null) =>
    value === 'rendered' || value === 'ancestor';

  if (present(state.base) && state.candidate === 'absent') {
    return 'base';
  }

  return present(state.candidate) && state.base === 'absent'
    ? 'candidate'
    : null;
}

export function changedNode(node: TreeNode): boolean {
  return (
    node.change === 'more' ||
    node.change === 'fewer' ||
    oneSided(node.state) !== null
  );
}

// The tree in reading order with box-drawing guides. In a comparison,
// consecutive siblings whose subtrees hold no change fold into one row
// until that row's key is opened.
export function treeRows(
  tree: RenderTree,
  all: boolean,
  opened: ReadonlySet<string>,
): TreeRow[] {
  const rows: TreeRow[] = [];

  const visit = (
    nodes: readonly TreeNode[],
    guides: string,
    depth: number,
    ancestors: readonly number[],
  ) => {
    const items: ({ node: TreeNode } | { fold: TreeNode[]; key: string })[] =
      [];

    for (const node of nodes) {
      const last = items.at(-1);

      if (all || !tree.comparing || node.notable > 0) {
        items.push({ node });
      } else if (last !== undefined && 'fold' in last) {
        last.fold.push(node);
      } else {
        items.push({ fold: [node], key: `fold:${node.key}` });
      }
    }

    const expanded = items.flatMap((item) =>
      'fold' in item && opened.has(item.key)
        ? item.fold.map((node) => ({ node }))
        : [item],
    );

    expanded.forEach((item, index) => {
      const lastChild = index === expanded.length - 1;
      const branch = lastChild ? '└─' : '├─';
      const connector = depth === 0 ? '' : branch;
      const at = rows.length;

      if ('fold' in item) {
        rows.push({
          kind: 'fold',
          key: item.key,
          nodes: item.fold,
          size: item.fold.reduce((sum, node) => sum + node.size, 0),
          depth,
          guides,
          connector,
          ancestors,
          end: at,
        });

        return;
      }

      rows.push({
        kind: 'node',
        key: item.node.key,
        node: item.node,
        depth,
        guides,
        connector,
        ancestors,
        end: at,
      });
      visit(
        item.node.children,
        depth === 0 ? '' : `${guides}${lastChild ? '  ' : '│ '}`,
        depth + 1,
        [...ancestors, at],
      );

      const row = rows[at];

      if (row !== undefined) {
        rows[at] = { ...row, end: rows.length - 1 };
      }
    });
  };

  visit(tree.roots, '', 0, []);

  return rows;
}
