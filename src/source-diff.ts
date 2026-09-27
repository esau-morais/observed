// Where a source line sits in the base..candidate diff. `context` is an
// unchanged line inside a hunk with Git's default three lines of context,
// where GitHub accepts review comments; `unchanged` is outside every hunk.
export type LineChange = 'added' | 'removed' | 'context' | 'unchanged';

export type FileDiff = {
  base: readonly LineChange[];
  candidate: readonly LineChange[];
};

const contextLines = 3;

// Larger files and edits are left out rather than diffed slowly.
export const maxDiffLines = 20_000;
const maxEdits = 2_000;

type Operation = 'equal' | 'delete' | 'insert';

// Myers' O(ND) shortest edit script. Round d keeps the furthest x on each
// diagonal k in -d..d, stored at index k + d.
function editScript(
  before: readonly string[],
  after: readonly string[],
): Operation[] | null {
  const rounds: Int32Array[] = [];
  let previous = new Int32Array(1);

  for (let distance = 0; distance <= maxEdits; distance++) {
    const current = new Int32Array(2 * distance + 1);
    const at = (diagonal: number) => previous[diagonal + distance - 1] ?? 0;

    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const down =
        diagonal === -distance ||
        (diagonal !== distance && at(diagonal - 1) < at(diagonal + 1));
      let x = down ? at(diagonal + 1) : at(diagonal - 1) + 1;

      if (distance === 0) {
        x = 0;
      }

      let y = x - diagonal;

      while (x < before.length && y < after.length && before[x] === after[y]) {
        x++;
        y++;
      }

      current[diagonal + distance] = x;

      if (x >= before.length && y >= after.length) {
        rounds.push(current);

        return backtrack(rounds, before.length, after.length);
      }
    }

    rounds.push(current);
    previous = current;
  }

  return null;
}

function backtrack(
  rounds: readonly Int32Array[],
  beforeLength: number,
  afterLength: number,
): Operation[] {
  const operations: Operation[] = [];
  let x = beforeLength;
  let y = afterLength;

  for (let distance = rounds.length - 1; distance > 0; distance--) {
    const previous = rounds[distance - 1] ?? new Int32Array(0);
    const at = (diagonal: number) => previous[diagonal + distance - 1] ?? 0;
    const diagonal = x - y;
    const down =
      diagonal === -distance ||
      (diagonal !== distance && at(diagonal - 1) < at(diagonal + 1));
    const previousDiagonal = down ? diagonal + 1 : diagonal - 1;
    const previousX = at(previousDiagonal);
    const previousY = previousX - previousDiagonal;
    const startX = down ? previousX : previousX + 1;

    while (x > startX) {
      operations.push('equal');
      x--;
      y--;
    }

    operations.push(down ? 'insert' : 'delete');
    x = previousX;
    y = previousY;
  }

  while (x > 0) {
    operations.push('equal');
    x--;
  }

  return operations.reverse();
}

export function lines(text: string): string[] {
  const split = text.split('\n');

  return split.at(-1) === '' ? split.slice(0, -1) : split;
}

export function diffLines(before: string, after: string): FileDiff | null {
  const left = lines(before);
  const right = lines(after);

  if (left.length > maxDiffLines || right.length > maxDiffLines) {
    return null;
  }

  const operations = editScript(left, right);

  if (operations === null) {
    return null;
  }

  const near = operations.map(() => false);

  for (const [index, operation] of operations.entries()) {
    if (operation === 'equal') {
      continue;
    }

    for (const direction of [-1, 1]) {
      let seen = 0;

      for (
        let other = index + direction;
        other >= 0 && other < operations.length && seen < contextLines;
        other += direction
      ) {
        if (operations[other] === 'equal') {
          near[other] = true;
          seen++;
        }
      }
    }
  }

  const base: LineChange[] = [];
  const candidate: LineChange[] = [];

  for (const [index, operation] of operations.entries()) {
    if (operation === 'delete') {
      base.push('removed');
    } else if (operation === 'insert') {
      candidate.push('added');
    } else {
      const change = near[index] === true ? 'context' : 'unchanged';
      base.push(change);
      candidate.push(change);
    }
  }

  return { base, candidate };
}
