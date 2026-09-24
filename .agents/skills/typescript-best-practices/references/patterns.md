# TypeScript patterns for Observed

These examples explain type design. They are not the final evidence schema.

## Represent unavailable evidence

```ts
type Measurement =
  | { kind: 'captured'; value: number; unit: 'ms'; runId: string }
  | { kind: 'unavailable'; reason: string; runId: string };

function describeMeasurement(measurement: Measurement): string {
  switch (measurement.kind) {
    case 'captured':
      return `${measurement.value} ${measurement.unit}`;
    case 'unavailable':
      return `Unknown: ${measurement.reason}`;
    default: {
      const exhaustive: never = measurement;
      return exhaustive;
    }
  }
}
```

Do not use zero for unavailable evidence. Parse captured values before constructing this internal type.

## Keep array access honest

```ts
type NonEmpty<T> = readonly [T, ...T[]];

function first<T>(values: NonEmpty<T>): T {
  return values[0];
}

function atIndex<T>(values: readonly T[], index: number): T | undefined {
  return values[index];
}
```

A non-empty array guarantees index zero. It does not prove a calculated index is present.

## Validate a numeric invariant

```ts
type DurationMs = number & { readonly __brand: 'DurationMs' };

function parseDurationMs(input: unknown): DurationMs {
  if (typeof input !== 'number' || !Number.isFinite(input) || input < 0) {
    throw new Error('Expected a finite non-negative duration');
  }
  return input as DurationMs;
}
```

The assertion records a checked constraint. A plain durationMs: number field cannot guarantee a non-negative duration. Use the brand only when the invariant must cross function boundaries.

## Separate type checking from parsing

```ts
type CaptureOptions = { format: 'json'; timeoutMs: number };

const captureOptions = {
  format: 'json',
  timeoutMs: 10_000,
} satisfies CaptureOptions;
```

The satisfies operator checks an authored object. It does not parse JSON, verify provider responses, or constrain timeoutMs to positive values. Use the existing schema library for structured external data. Do not add a library to reproduce an example.
