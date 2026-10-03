import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { MapBlock } from '../comparison-model';
import type { DirectoryNode, VisibleMap } from './map-model';

export type Box = { x: number; y: number; width: number; height: number };

export type Layout = {
  width: number;
  height: number;
  blocks: Map<string, Box>;
  directories: Map<string, Box>;
  journeys: Box | null;
};

const sizes = {
  file: { width: 184, height: 64 },
  package: { width: 160, height: 52 },
  journey: { width: 184, height: 52 },
  route: { width: 216, height: 52 },
} satisfies Record<MapBlock['kind'], { width: number; height: number }>;

const groupPadding = '[top=40,left=12,bottom=12,right=12]';

export const directoryId = (path: string) => `directory:${path}`;

const journeysId = 'layer:journeys';

function directoryNode(node: DirectoryNode): ElkNode {
  return {
    id: directoryId(node.path),
    layoutOptions: { 'elk.padding': groupPadding },
    children: [
      ...node.directories.map(directoryNode),
      ...node.files.map((block) => ({ id: block.id, ...sizes.file })),
    ],
  };
}

function collect(
  node: ElkNode,
  offset: { x: number; y: number },
  layout: Layout,
) {
  for (const child of node.children ?? []) {
    const box = {
      x: offset.x + (child.x ?? 0),
      y: offset.y + (child.y ?? 0),
      width: child.width ?? 0,
      height: child.height ?? 0,
    };

    if (child.id.startsWith('directory:')) {
      layout.directories.set(child.id.slice('directory:'.length), box);
    } else if (child.id === journeysId) {
      layout.journeys = box;
    } else {
      layout.blocks.set(child.id, box);
    }

    collect(child, box, layout);
  }
}

const elk = new ELK();

// Positions only. The connections drawn come from the map, not from ELK's
// routing, and layout never adds or drops a block.
export async function layoutMap(
  visible: VisibleMap,
  direction: 'RIGHT' | 'DOWN',
): Promise<Layout> {
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.spacing.nodeNode': '20',
      'elk.layered.spacing.nodeNodeBetweenLayers': '56',
      'elk.spacing.componentComponent': '32',
      'elk.padding': '[top=8,left=8,bottom=8,right=8]',
    },
    children: [
      directoryNode(visible.tree),
      ...visible.packages.map((block) => ({ id: block.id, ...sizes.package })),
      ...(visible.journeys.length === 0
        ? []
        : [
            {
              id: journeysId,
              layoutOptions: { 'elk.padding': groupPadding },
              children: visible.journeys.map((block) => ({
                id: block.id,
                ...sizes[block.kind],
              })),
            },
          ]),
    ],
    edges: visible.connections.map((connection, index) => ({
      id: `edge:${index}`,
      sources: [connection.from],
      targets: [connection.to],
    })),
  };
  const placed = await elk.layout(graph);
  const layout: Layout = {
    width: placed.width ?? 0,
    height: placed.height ?? 0,
    blocks: new Map(),
    directories: new Map(),
    journeys: null,
  };

  collect(placed, { x: 0, y: 0 }, layout);

  return layout;
}
