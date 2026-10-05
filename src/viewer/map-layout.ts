import ELK, { type ElkNode } from 'elkjs/lib/elk-api';
import workerSource from 'elkjs/lib/elk-worker.min.js?raw';
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

// ELK determines the import order and routes. Outside blocks stay in a separate row.
export async function layoutGraph(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  options: LayoutOptions,
): Promise<Layout> {
  const inside = nodes.filter((node) => !node.bottom);
  const outside = nodes.filter((node) => node.bottom);
  const ids = new Set(inside.map((node) => node.id));
  const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
  const elk = new ELK({ workerFactory: () => new Worker(workerUrl) });
  const input: ElkNode = {
    id: 'map',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.randomSeed': '1',
      'elk.spacing.nodeNode': String(options.nodeGap),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(options.rankGap),
      'elk.aspectRatio': String(Math.max(0.5, options.maxWidth / 700)),
      'elk.padding': '[top=0,left=0,bottom=0,right=0]',
    },
    children: inside.map(({ id, width, height }) => ({ id, width, height })),
    edges: edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)).map((edge) => ({
      id: edge.id, sources: [edge.from], targets: [edge.to],
    })),
  };
  const graph = await elk.layout(input).finally(() => {
    elk.terminateWorker();
    URL.revokeObjectURL(workerUrl);
  });
  const boxes = new Map<string, Box>();
  for (const node of graph.children ?? []) {
    boxes.set(node.id, { x: node.x ?? 0, y: node.y ?? 0, width: node.width ?? 0, height: node.height ?? 0 });
  }
  let width = graph.width ?? 0;
  let height = graph.height ?? 0;
  const bottomTop = outside.length === 0 ? null : height + options.bottomGap;
  let x = 0;
  let y = bottomTop ?? 0;
  let rowHeight = 0;
  for (const node of outside) {
    if (x > 0 && x + node.width > options.maxWidth) {
      x = 0;
      y += rowHeight + options.nodeGap;
      rowHeight = 0;
    }
    boxes.set(node.id, { x, y, width: node.width, height: node.height });
    width = Math.max(width, x + node.width);
    height = Math.max(height, y + node.height);
    x += node.width + options.nodeGap;
    rowHeight = Math.max(rowHeight, node.height);
  }
  const routes = new Map<string, Point[]>();
  for (const edge of graph.edges ?? []) {
    const section = edge.sections?.[0];
    if (section !== undefined) {
      routes.set(edge.id, [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]);
    }
  }
  for (const edge of edges) {
    if (routes.has(edge.id)) { continue; }
    const from = boxes.get(edge.from);
    const to = boxes.get(edge.to);
    if (from !== undefined && to !== undefined) {
      routes.set(edge.id, [
        { x: from.x + from.width / 2, y: from.y + from.height },
        { x: to.x + to.width / 2, y: to.y },
      ]);
    }
  }
  return { width, height, nodes: boxes, edges: routes, bottomTop };
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
