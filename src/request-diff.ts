import type { Observations } from './capture/model';

type Request = Observations['requests'][number];

// A status of 0 was not recorded. When the sides recorded a different number
// of them, the status difference is unknown rather than changed.
export type RequestChange =
  'added' | 'removed' | 'count' | 'status' | 'unknown' | 'same';

export type RequestRow = {
  readonly method: string;
  readonly origin: Request['origin'];
  readonly path: string;
  readonly base: readonly number[];
  readonly candidate: readonly number[];
  readonly change: RequestChange;
};

const changeOrder = {
  added: 0,
  removed: 1,
  count: 2,
  status: 3,
  unknown: 4,
  same: 5,
} satisfies Record<RequestChange, number>;

function key(request: Request): string {
  return JSON.stringify([request.method, request.origin, request.path]);
}

function changeOf(
  base: readonly number[],
  candidate: readonly number[],
): RequestChange {
  if (base.length === 0) {
    return 'added';
  }

  if (candidate.length === 0) {
    return 'removed';
  }

  if (base.length !== candidate.length) {
    return 'count';
  }

  if (base.join() === candidate.join()) {
    return 'same';
  }

  const unrecorded = (statuses: readonly number[]) =>
    statuses.filter((status) => status === 0).length;

  return unrecorded(base) === unrecorded(candidate) ? 'status' : 'unknown';
}

// One row per method, origin and path, with each side's response statuses in
// sorted order. Changed rows come first, then rows in first-seen order.
export function requestDiff(
  base: readonly Request[],
  candidate: readonly Request[],
): RequestRow[] {
  const rows = new Map<
    string,
    { request: Request; base: number[]; candidate: number[]; order: number }
  >();

  const add = (request: Request, side: 'base' | 'candidate') => {
    const id = key(request);
    const row = rows.get(id) ?? {
      request,
      base: [],
      candidate: [],
      order: rows.size,
    };

    row[side].push(request.status);
    rows.set(id, row);
  };

  base.forEach((request) => add(request, 'base'));
  candidate.forEach((request) => add(request, 'candidate'));

  return [...rows.values()]
    .map(({ request, order, ...sides }) => {
      const before = sides.base.toSorted((a, b) => a - b);
      const after = sides.candidate.toSorted((a, b) => a - b);

      return {
        order,
        row: {
          method: request.method,
          origin: request.origin,
          path: request.path,
          base: before,
          candidate: after,
          change: changeOf(before, after),
        },
      };
    })
    .sort((a, b) => {
      const byChange = changeOrder[a.row.change] - changeOrder[b.row.change];

      return byChange === 0 ? a.order - b.order : byChange;
    })
    .map(({ row }) => row);
}
