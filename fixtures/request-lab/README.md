# Request lab

An original React fixture authored for Observed's controlled request comparison.
No application code or assets were copied from other projects.

Vite serves this directory as its root, using `index.html` and `main.tsx`.
Resolve `fixture-variant` to one source module at build or server startup:

| Module | Heading | GET /api/items requests per click |
| --- | --- | --- |
| `base.ts` | Request lab | 1 |
| `duplicate.ts` | Request lab | 2 |
| `visual.ts` | Item collection | 1 |

Each module exports `title: string` and
`loadItems(): Promise<readonly Item[]>`. `Item` is derived from the Effect schema
in `items.ts`. The duplicate variant waits for both requests to settle and
returns the first collection, keeping its completed UI identical to base.

The capture application serves the same-origin `GET /api/items` endpoint and
owns the request ledger. Responses must be an array of `{ id, name }` items.
The fixture makes uncached requests without credentials or external services.

The button is named `Load items`. The `status` region becomes `Items loaded`
after all requests finish and response data validates. The fixed expectation is
one completed GET per click; the duplicate variant intentionally violates it.
