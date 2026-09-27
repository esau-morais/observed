import type { Schema } from 'effect';
import type { EvidenceValue } from './evidence-kinds';
import { isJsonObject, jsonType } from './json-schema';

type Recorded = EvidenceValue<'api'>['operations'][number];

type Shape = {
  readonly types: ReadonlyMap<string, ReadonlySet<string>>;
  // Arrays with no elements, whose element fields are unknown.
  readonly empty: ReadonlySet<string>;
};

function field(path: string, key: string): string {
  const name = /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);

  return path === '' ? name : `${path}.${name}`;
}

// Field paths such as stations[].name, each with the JSON types seen there.
export function shapeOf(value: Schema.Json): Shape {
  const types = new Map<string, Set<string>>();
  const empty = new Set<string>();

  const visit = (entry: Schema.Json, path: string) => {
    const type = jsonType(entry);
    const seen = types.get(path) ?? new Set<string>();

    seen.add(type);
    types.set(path, seen);

    if (Array.isArray(entry)) {
      const items: readonly Schema.Json[] = entry;

      if (items.length === 0) {
        empty.add(path);
      }

      for (const item of items) {
        visit(item, `${path}[]`);
      }
    } else if (isJsonObject(entry)) {
      for (const [key, nested] of Object.entries(entry)) {
        visit(nested, field(path, key));
      }
    }
  };

  visit(value, '');

  return { types, empty };
}

export type FieldChange =
  | { readonly kind: 'added'; readonly path: string; readonly type: string }
  | { readonly kind: 'removed'; readonly path: string; readonly type: string }
  | {
      readonly kind: 'retyped';
      readonly path: string;
      readonly base: string;
      readonly candidate: string;
    };

const describeTypes = (types: ReadonlySet<string>) =>
  [...types].sort().join(' or ');

function under(path: string, parent: string): boolean {
  return (
    parent === '' ||
    path.startsWith(`${parent}.`) ||
    path.startsWith(`${parent}[]`)
  );
}

// Added and removed fields are listed at their outermost path. Fields inside
// an array that is empty on either side are not compared.
export function compareShapes(base: Shape, candidate: Shape): FieldChange[] {
  const unknown = [...base.empty, ...candidate.empty].map(
    (path) => `${path}[]`,
  );
  const comparable = (path: string) =>
    path !== '' &&
    !unknown.some((prefix) => path === prefix || under(path, prefix));
  const changes: FieldChange[] = [];
  const baseRoot = base.types.get('');
  const candidateRoot = candidate.types.get('');

  if (
    baseRoot !== undefined &&
    candidateRoot !== undefined &&
    describeTypes(baseRoot) !== describeTypes(candidateRoot)
  ) {
    changes.push({
      kind: 'retyped',
      path: '(body)',
      base: describeTypes(baseRoot),
      candidate: describeTypes(candidateRoot),
    });
  }

  for (const [path, types] of candidate.types) {
    const before = base.types.get(path);

    if (!comparable(path)) {
      continue;
    }

    if (before === undefined) {
      changes.push({ kind: 'added', path, type: describeTypes(types) });
    } else if (describeTypes(before) !== describeTypes(types)) {
      changes.push({
        kind: 'retyped',
        path,
        base: describeTypes(before),
        candidate: describeTypes(types),
      });
    }
  }

  for (const [path, types] of base.types) {
    if (comparable(path) && !candidate.types.has(path)) {
      changes.push({ kind: 'removed', path, type: describeTypes(types) });
    }
  }

  const outermost = changes.filter(
    (change) =>
      change.kind === 'retyped' ||
      !changes.some(
        (other) =>
          other !== change &&
          other.kind === change.kind &&
          under(change.path, other.path) &&
          other.path !== change.path,
      ),
  );

  return outermost.sort((left, right) =>
    left.path < right.path ? -1 : Number(left.path > right.path),
  );
}

export type ContractComparison =
  | { readonly kind: 'compared'; readonly changes: readonly FieldChange[] }
  | { readonly kind: 'unavailable'; readonly reason: string };

function bodyLabel(operation: Recorded): string {
  return operation.result.kind === 'response'
    ? operation.result.body.kind
    : 'missing';
}

// A contract difference is an observation. Checks decide the verdict.
export function compareContract(
  base: Recorded,
  candidate: Recorded,
): ContractComparison {
  if (base.result.kind === 'failed' || candidate.result.kind === 'failed') {
    return {
      kind: 'unavailable',
      reason: 'A request received no response',
    };
  }

  if (
    base.result.body.kind !== 'json' ||
    candidate.result.body.kind !== 'json'
  ) {
    return {
      kind: 'unavailable',
      reason: `Body is ${bodyLabel(base)} on base and ${bodyLabel(candidate)} on candidate; only JSON bodies are compared`,
    };
  }

  return {
    kind: 'compared',
    changes: compareShapes(
      shapeOf(base.result.body.value),
      shapeOf(candidate.result.body.value),
    ),
  };
}

export function describeFieldChange(change: FieldChange): string {
  switch (change.kind) {
    case 'added':
      return `Added ${change.path} (${change.type})`;
    case 'removed':
      return `Removed ${change.path} (${change.type})`;
    case 'retyped':
      return `${change.path} changed from ${change.base} to ${change.candidate}`;
  }
}
