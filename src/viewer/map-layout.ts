export type Box = { x: number; y: number; width: number; height: number };

export type Point = { x: number; y: number };

export type LayoutNode = {
  id: string;
  width: number;
  height: number;
  // Bottom nodes share one rank under every other node, as the outside row.
  bottom: boolean;
};

export type LayoutEdge = { id: string; from: string; to: string };

export type Layout = {
  width: number;
  height: number;
  nodes: Map<string, Box>;
  // Each edge runs from its `from` node to its `to` node, through the gaps
  // between ranks.
  edges: Map<string, Point[]>;
  // The y where the bottom rank starts, or null without bottom nodes.
  bottomTop: number | null;
};

export type LayoutOptions = {
  // The widest a rank may grow before it wraps onto another row.
  maxWidth: number;
  nodeGap: number;
  rankGap: number;
  bottomGap: number;
};

const laneWidth = 6;

type Slot = {
  id: string;
  width: number;
  height: number;
  real: boolean;
  rank: number;
  x: number;
};

type Segment = { from: string; to: string };

const byId = (left: string, right: string) =>
  left < right ? -1 : Number(left > right);

// Ranks from the longest path, so every edge points down. An edge that closes
// a cycle is reversed for ranking only.
function rankNodes(
  ids: readonly string[],
  edges: readonly LayoutEdge[],
): Map<string, number> {
  const outgoing = new Map(ids.map((id) => [id, [] as string[]]));

  for (const edge of edges) {
    outgoing.get(edge.from)?.push(edge.to);
  }

  for (const list of outgoing.values()) {
    list.sort(byId);
  }

  const state = new Map<string, 'open' | 'done'>();
  const order: string[] = [];
  const back = new Set<string>();

  const visit = (id: string) => {
    state.set(id, 'open');

    for (const next of outgoing.get(id) ?? []) {
      const seen = state.get(next);

      if (seen === 'open') {
        back.add(`${id}\u0000${next}`);
      } else if (seen === undefined) {
        visit(next);
      }
    }

    state.set(id, 'done');
    order.push(id);
  };

  for (const id of [...ids].sort(byId)) {
    if (!state.has(id)) {
      visit(id);
    }
  }

  const ranks = new Map(ids.map((id) => [id, 0]));
  const forward = (id: string) =>
    (outgoing.get(id) ?? []).filter((next) => !back.has(`${id}\u0000${next}`));
  const topological = order.reverse();

  for (const id of topological) {
    for (const next of forward(id)) {
      ranks.set(next, Math.max(ranks.get(next) ?? 0, (ranks.get(id) ?? 0) + 1));
    }
  }

  // Move each node down to just above its nearest successor, so an edge
  // from a source does not cross every row above its target.
  for (const id of [...topological].reverse()) {
    const below = forward(id).map((next) => ranks.get(next) ?? 0);

    if (below.length > 0) {
      ranks.set(id, Math.max(ranks.get(id) ?? 0, Math.min(...below) - 1));
    }
  }

  return ranks;
}

// Pool adjacent violators: the positions closest to `desired`, in least
// squares, that keep the order and each node's minimum distance from the
// previous one.
function placeInOrder(
  desired: readonly number[],
  widths: readonly number[],
  gaps: readonly number[],
): number[] {
  const offsets: number[] = [];
  let offset = 0;

  for (let index = 0; index < desired.length; index += 1) {
    if (index > 0) {
      offset +=
        (widths[index - 1] ?? 0) / 2 +
        (gaps[index] ?? 0) +
        (widths[index] ?? 0) / 2;
    }

    offsets.push(offset);
  }

  const blocks: { sum: number; count: number }[] = [];

  for (let index = 0; index < desired.length; index += 1) {
    blocks.push({
      sum: (desired[index] ?? 0) - (offsets[index] ?? 0),
      count: 1,
    });

    while (blocks.length > 1) {
      const last = blocks.at(-1);
      const previous = blocks.at(-2);

      if (
        last === undefined ||
        previous === undefined ||
        previous.sum / previous.count <= last.sum / last.count
      ) {
        break;
      }

      blocks.pop();
      previous.sum += last.sum;
      previous.count += last.count;
    }
  }

  const values: number[] = [];

  for (const block of blocks) {
    for (let index = 0; index < block.count; index += 1) {
      values.push(block.sum / block.count);
    }
  }

  return values.map((value, index) => value + (offsets[index] ?? 0));
}

function crossings(
  upper: readonly string[],
  lower: readonly string[],
  segments: readonly Segment[],
): number {
  const top = new Map(upper.map((id, index) => [id, index]));
  const bottom = new Map(lower.map((id, index) => [id, index]));
  const pairs = segments.flatMap((segment) => {
    const from = top.get(segment.from);
    const to = bottom.get(segment.to);

    return from === undefined || to === undefined ? [] : [[from, to] as const];
  });
  let count = 0;

  for (let left = 0; left < pairs.length; left += 1) {
    for (let right = left + 1; right < pairs.length; right += 1) {
      const [a, b] = pairs[left] ?? [0, 0];
      const [c, d] = pairs[right] ?? [0, 0];

      if ((a - c) * (b - d) < 0) {
        count += 1;
      }
    }
  }

  return count;
}

// A layered top-down layout. Ranks wider than `maxWidth` wrap onto extra
// rows, edges that skip ranks pass through lanes between nodes, and the same
// input always gives the same layout.
export function layoutGraph(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  options: LayoutOptions,
): Layout {
  const inner = nodes.filter((node) => !node.bottom);
  const bottom = nodes.filter((node) => node.bottom);
  const known = new Map(nodes.map((node) => [node.id, node]));
  const innerIds = new Set(inner.map((node) => node.id));
  const usable = edges.filter(
    (edge) =>
      edge.from !== edge.to &&
      known.has(edge.from) &&
      known.has(edge.to) &&
      (innerIds.has(edge.from) || innerIds.has(edge.to)),
  );
  const innerEdges = usable.filter(
    (edge) => innerIds.has(edge.from) && innerIds.has(edge.to),
  );
  const ranked = rankNodes(
    inner.map((node) => node.id),
    innerEdges,
  );
  const perRow = (list: readonly LayoutNode[]) => {
    const widest = Math.max(...list.map((node) => node.width), 1);

    return Math.max(
      1,
      Math.floor(
        (options.maxWidth + options.nodeGap) / (widest + options.nodeGap),
      ),
    );
  };

  // Wrap each rank, ordering it by its neighbors above so a wrapped row keeps
  // nodes near the ones they connect to.
  const rows: string[][] = [];
  const rowOf = new Map<string, number>();
  const groups = new Map<number, string[]>();

  for (const node of inner) {
    const rank = ranked.get(node.id) ?? 0;
    groups.set(rank, [...(groups.get(rank) ?? []), node.id]);
  }

  const incoming = new Map<string, string[]>();

  for (const edge of usable) {
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
    incoming.set(edge.from, [...(incoming.get(edge.from) ?? []), edge.to]);
  }

  const position = new Map<string, number>();
  const wrap = (ids: string[], cap: number) => {
    const scored = ids
      .map((id) => {
        const near = (incoming.get(id) ?? []).flatMap((other) => {
          const at = position.get(other);

          return at === undefined ? [] : [at];
        });

        return {
          id,
          score:
            near.length === 0
              ? Number.POSITIVE_INFINITY
              : near.reduce((sum, value) => sum + value, 0) / near.length,
        };
      })
      .sort((left, right) =>
        left.score === right.score
          ? byId(left.id, right.id)
          : left.score - right.score,
      );

    for (let start = 0; start < scored.length; start += cap) {
      const row = scored.slice(start, start + cap).map((item) => item.id);

      row.forEach((id, index) => {
        rowOf.set(id, rows.length);
        position.set(id, index - (row.length - 1) / 2);
      });
      rows.push(row);
    }
  };

  for (const rank of [...groups.keys()].sort((left, right) => left - right)) {
    const ids = groups.get(rank) ?? [];

    wrap(ids, perRow(ids.flatMap((id) => known.get(id) ?? [])));
  }

  const innerRows = rows.length;

  if (bottom.length > 0) {
    wrap(
      bottom.map((node) => node.id),
      perRow(bottom),
    );
  }

  // Every edge points down a row; one that points up is laid out reversed.
  // Edges that skip rows get a lane slot in each row they cross.
  const slots = new Map<string, Slot>();

  for (const [index, row] of rows.entries()) {
    for (const id of row) {
      const node = known.get(id);

      if (node !== undefined) {
        slots.set(id, {
          id,
          width: node.width,
          height: node.height,
          real: true,
          rank: index,
          x: 0,
        });
      }
    }
  }

  const chains = new Map<string, { path: string[]; reversed: boolean }>();
  const segments: Segment[] = [];
  const segmentKeys = new Set<string>();

  for (const edge of [...usable].sort((left, right) =>
    byId(left.id, right.id),
  )) {
    const from = rowOf.get(edge.from);
    const to = rowOf.get(edge.to);

    if (from === undefined || to === undefined || from === to) {
      continue;
    }

    const reversed = from > to;
    const [top, bottomEnd] = reversed
      ? [edge.to, edge.from]
      : [edge.from, edge.to];
    const [start, end] = reversed ? [to, from] : [from, to];
    const path = [top];

    // Long edges from the same node share one lane per row, so they run
    // as one bundle and split only where their targets are.
    for (let rank = start + 1; rank < end; rank += 1) {
      const id = `lane:${top}:${rank}`;

      if (!slots.has(id)) {
        slots.set(id, {
          id,
          width: laneWidth,
          height: 0,
          real: false,
          rank,
          x: 0,
        });
        rows[rank]?.push(id);
      }

      path.push(id);
    }

    path.push(bottomEnd);
    chains.set(edge.id, { path, reversed });

    for (let index = 1; index < path.length; index += 1) {
      const segment = { from: path[index - 1] ?? '', to: path[index] ?? '' };
      const key = `${segment.from}\u0000${segment.to}`;

      if (!segmentKeys.has(key)) {
        segmentKeys.add(key);
        segments.push(segment);
      }
    }
  }

  // Barycenter sweeps, keeping the order with the fewest crossings.
  const above = new Map<string, string[]>();
  const below = new Map<string, string[]>();

  for (const segment of segments) {
    below.set(segment.from, [...(below.get(segment.from) ?? []), segment.to]);
    above.set(segment.to, [...(above.get(segment.to) ?? []), segment.from]);
  }

  const total = (order: string[][]) =>
    order
      .slice(1)
      .reduce(
        (sum, row, index) => sum + crossings(order[index] ?? [], row, segments),
        0,
      );
  let best = rows.map((row) => [...row]);
  let bestCount = total(best);
  const order = rows.map((row) => [...row]);

  for (let sweep = 0; sweep < 12 && bestCount > 0; sweep += 1) {
    const down = sweep % 2 === 0;
    const sequence = order.map((_, index) => index);

    for (const rank of down
      ? sequence.slice(1)
      : sequence.slice(0, -1).reverse()) {
      const row = order[rank] ?? [];
      const reference = order[down ? rank - 1 : rank + 1] ?? [];
      const at = new Map(reference.map((id, index) => [id, index]));
      const scored = row.map((id, index) => {
        const near = ((down ? above : below).get(id) ?? []).flatMap((other) => {
          const value = at.get(other);

          return value === undefined ? [] : [value];
        });

        return {
          id,
          index,
          score:
            near.length === 0
              ? index
              : near.reduce((sum, value) => sum + value, 0) / near.length,
        };
      });

      scored.sort((left, right) =>
        left.score === right.score
          ? left.index - right.index
          : left.score - right.score,
      );
      order[rank] = scored.map((item) => item.id);
    }

    const count = total(order);

    if (count < bestCount) {
      bestCount = count;
      best = order.map((row) => [...row]);
    }
  }

  // Horizontal positions: start packed, then pull each node toward the mean
  // of its neighbors without breaking the order.
  const gapBetween = (left: Slot | undefined, right: Slot | undefined) =>
    left?.real === true && right?.real === true ? options.nodeGap : 4;

  for (const row of best) {
    let x = 0;

    for (const [index, id] of row.entries()) {
      const slot = slots.get(id);

      if (slot === undefined) {
        continue;
      }

      if (index > 0) {
        x += gapBetween(slots.get(row[index - 1] ?? ''), slot);
      }

      slot.x = x + slot.width / 2;
      x += slot.width;
    }
  }

  const center = (id: string) => slots.get(id)?.x ?? 0;

  for (let pass = 0; pass < 16; pass += 1) {
    const down = pass % 2 === 0;
    const sequence = best.map((_, index) => index);

    for (const rank of down ? sequence : [...sequence].reverse()) {
      const row = best[rank] ?? [];
      const desired = row.map((id) => {
        const near = [...(above.get(id) ?? []), ...(below.get(id) ?? [])];

        return near.length === 0
          ? center(id)
          : near.reduce((sum, other) => sum + center(other), 0) / near.length;
      });
      const rowSlots = row.map((id) => slots.get(id));
      const placed = placeInOrder(
        desired,
        rowSlots.map((slot) => slot?.width ?? 0),
        rowSlots.map((slot, index) =>
          index === 0 ? 0 : gapBetween(rowSlots[index - 1], slot),
        ),
      );

      // Keep the row inside the available width.
      const first = rowSlots[0];
      const last = rowSlots.at(-1);
      const low = (placed[0] ?? 0) - (first?.width ?? 0) / 2;
      const high = (placed.at(-1) ?? 0) + (last?.width ?? 0) / 2;
      const shift =
        high - low > options.maxWidth
          ? -low
          : Math.min(0, options.maxWidth - high) + Math.max(0, -low);

      for (const [index, slot] of rowSlots.entries()) {
        if (slot !== undefined) {
          slot.x = (placed[index] ?? slot.x) + shift;
        }
      }
    }
  }

  const all = [...slots.values()];
  const left = Math.min(...all.map((slot) => slot.x - slot.width / 2), 0);
  const right = Math.max(...all.map((slot) => slot.x + slot.width / 2), 0);
  const tops: number[] = [];
  let y = 0;

  for (const [index, row] of best.entries()) {
    if (index === innerRows && index > 0) {
      y += options.bottomGap - options.rankGap;
    }

    tops.push(y);
    y +=
      Math.max(0, ...row.map((id) => slots.get(id)?.height ?? 0)) +
      options.rankGap;
  }

  const height = Math.max(0, y - options.rankGap);
  const rowHeight = (rank: number) =>
    Math.max(0, ...(best[rank] ?? []).map((id) => slots.get(id)?.height ?? 0));
  const boxes = new Map<string, Box>();

  for (const slot of all) {
    if (slot.real) {
      boxes.set(slot.id, {
        x: slot.x - slot.width / 2 - left,
        y: tops[slot.rank] ?? 0,
        width: slot.width,
        height: slot.height,
      });
    }
  }

  // Ports spread along a node's bottom and top edges in the order of the
  // nodes they lead to, so neighboring edges don't cross at the node.
  const ports = new Map<string, number>();
  const spread = (id: string, ends: { key: string; x: number }[]) => {
    const box = boxes.get(id);

    if (box === undefined) {
      return;
    }

    ends.sort((a, b) => (a.x === b.x ? byId(a.key, b.key) : a.x - b.x));
    ends.forEach((end, index) => {
      ports.set(
        end.key,
        box.x + box.width * (0.2 + (0.6 * (index + 1)) / (ends.length + 1)),
      );
    });
  };

  const leaving = new Map<string, { key: string; x: number }[]>();
  const arriving = new Map<string, { key: string; x: number }[]>();

  for (const [id, chain] of chains) {
    const first = chain.path[0] ?? '';
    const second = chain.path[1] ?? '';
    const last = chain.path.at(-1) ?? '';
    const beforeLast = chain.path.at(-2) ?? '';

    leaving.set(first, [
      ...(leaving.get(first) ?? []),
      { key: `${id}:out`, x: center(second) },
    ]);
    arriving.set(last, [
      ...(arriving.get(last) ?? []),
      { key: `${id}:in`, x: center(beforeLast) },
    ]);
  }

  for (const [id, ends] of leaving) {
    spread(id, ends);
  }

  for (const [id, ends] of arriving) {
    spread(id, ends);
  }

  const edgePoints = new Map<string, Point[]>();

  for (const [id, chain] of chains) {
    const points: Point[] = [];
    const first = slots.get(chain.path[0] ?? '');
    const last = slots.get(chain.path.at(-1) ?? '');

    if (first === undefined || last === undefined) {
      continue;
    }

    points.push({
      x: ports.get(`${id}:out`) ?? first.x - left,
      y: (tops[first.rank] ?? 0) + first.height,
    });

    for (const lane of chain.path.slice(1, -1)) {
      const slot = slots.get(lane);

      if (slot !== undefined) {
        points.push({ x: slot.x - left, y: tops[slot.rank] ?? 0 });
        points.push({
          x: slot.x - left,
          y: (tops[slot.rank] ?? 0) + rowHeight(slot.rank),
        });
      }
    }

    points.push({
      x: ports.get(`${id}:in`) ?? last.x - left,
      y: tops[last.rank] ?? 0,
    });
    edgePoints.set(id, chain.reversed ? points.reverse() : points);
  }

  return {
    width: right - left,
    height,
    nodes: boxes,
    edges: edgePoints,
    bottomTop: bottom.length > 0 ? (tops[innerRows] ?? null) : null,
  };
}

// A curve through the points with vertical tangents, so edges leave and
// enter nodes straight and bend between rows.
export function curve(points: readonly Point[]): string {
  const [first, ...rest] = points;

  if (first === undefined) {
    return '';
  }

  let path = `M ${first.x.toFixed(1)} ${first.y.toFixed(1)}`;
  let previous = first;

  for (const point of rest) {
    const bend = (point.y - previous.y) / 2;

    path +=
      Math.abs(point.x - previous.x) < 0.5
        ? ` L ${point.x.toFixed(1)} ${point.y.toFixed(1)}`
        : ` C ${previous.x.toFixed(1)} ${(previous.y + bend).toFixed(1)}, ${point.x.toFixed(1)} ${(point.y - bend).toFixed(1)}, ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
    previous = point;
  }

  return path;
}
