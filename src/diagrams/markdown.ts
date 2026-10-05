import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Nodes } from 'mdast';

type Block = { heading: string; order: number; source: string };

function* descendants(root: Nodes): Generator<Nodes> {
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) {
      continue;
    }

    yield node;
    if ('children' in node) {
      for (let index = node.children.length - 1; index >= 0; index--) {
        const child = node.children[index];
        if (child !== undefined) {
          pending.push(child);
        }
      }
    }
  }
}

export function mermaidBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const counts = new Map<string, number>();
  let heading = '';
  for (const node of descendants(fromMarkdown(markdown))) {
    if (node.type === 'heading') {
      heading = [...descendants(node)]
        .map((child) => ('value' in child ? child.value : ''))
        .join('');
    } else if (node.type === 'code' && node.lang === 'mermaid') {
      const order = (counts.get(heading) ?? 0) + 1;
      counts.set(heading, order);
      blocks.push({ heading, order, source: node.value });
    }
  }

  return blocks;
}

export function changedMermaidBlocks(base: string, candidate: string) {
  const key = (block: Block) => JSON.stringify([block.heading, block.order]);
  const before = new Map(
    mermaidBlocks(base).map((block) => [key(block), block]),
  );
  const after = new Map(
    mermaidBlocks(candidate).map((block) => [key(block), block]),
  );

  return [...new Set([...before.keys(), ...after.keys()])].flatMap((id) => {
    const left = before.get(id);
    const right = after.get(id);
    const block = right ?? left;

    return block === undefined || left?.source === right?.source
      ? []
      : [
          {
            heading: block.heading,
            order: block.order,
            change: changeKind(left, right),
            base: left?.source ?? null,
            candidate: right?.source ?? null,
          },
        ];
  });
}

function changeKind(
  left: Block | undefined,
  right: Block | undefined,
): 'added' | 'removed' | 'changed' {
  if (left === undefined) {
    return 'added';
  }

  return right === undefined ? 'removed' : 'changed';
}
