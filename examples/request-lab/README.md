# Request lab

One click, one request. This React example lets you compare that behavior with a
duplicate request or a changed heading.

The application was written for Observed's controlled request comparison.
No application code or assets were copied from other projects.

`App.tsx` imports `base.ts`. To try another version, change that import and add
the selected module to `source.paths` in `observed.json`:

| Module | Heading | GET /api/items requests per click |
| --- | --- | --- |
| `base.ts` | Request lab | 1 |
| `duplicate.ts` | Request lab | 2 |
| `visual.ts` | Item collection | 1 |

Each module exports `title: string` and
`loadItems(): Promise<readonly Item[]>`. `Item` is derived from the Effect schema
in `items.ts`. The duplicate variant waits for both requests to settle and
returns the first collection, keeping its completed UI identical to base.

`server.ts` serves the built app and the same-origin `GET /api/items` endpoint.
Responses are an array of `{ id, name }` items. The app makes uncached requests
without credentials or external services.

The button is named `Load items`. The `status` region becomes `Items loaded`
after all requests finish and response data validates. The fixed expectation is
one completed GET per click; the duplicate variant intentionally violates it.
