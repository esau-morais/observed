import path from 'node:path';

export type Side = 'base' | 'candidate';

export function runLayout(root: string) {
  const journey = (index: number) => `journey-${index + 1}`;

  return {
    root,
    selection: path.join(root, 'selection.json'),
    result: path.join(root, 'result.json'),
    timings: path.join(root, 'timings.json'),
    journey,
    capture: (index: number, side: Side) => path.join(root, journey(index), side),
  };
}

export type RunLayout = ReturnType<typeof runLayout>;
