import { Schema } from 'effect';
import { routeSchema, text as nonEmpty, timestamp } from '../capture/model';
import { defineEvidence } from './define';

const envName = nonEmpty.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/));
const headerName = nonEmpty.check(Schema.isPattern(/^[!#$%&'*+.^`|~\w-]+$/));

// An environment reference keeps the value out of observed.json, recipes and
// evidence. `prefix`, such as "Bearer ", is sent before it and recorded.
const headerText = Schema.String.check(Schema.isPattern(/^[^\p{Cc}]*$/u));

export const headerSchema = Schema.Union([
  Schema.Struct({ name: headerName, value: headerText }),
  Schema.Struct({
    name: headerName,
    env: envName,
    prefix: Schema.optionalKey(headerText),
  }),
]);

export const operationSchema = Schema.Struct({
  id: nonEmpty,
  method: nonEmpty.check(Schema.isPattern(/^[A-Z]+$/)),
  path: routeSchema,
  headers: Schema.optionalKey(Schema.Array(headerSchema)),
  body: Schema.optionalKey(
    Schema.Union([
      Schema.Struct({ json: Schema.Json }),
      Schema.Struct({ text: Schema.String }),
    ]),
  ),
});

export type Operation = typeof operationSchema.Type;

const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const httpStatusSchema = Schema.Int.check(
  Schema.isBetween({ minimum: 100, maximum: 599 }),
);

export const responseBodySchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('json'), value: Schema.Json }),
  Schema.Struct({ kind: Schema.Literal('text'), text: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('empty') }),
  Schema.Struct({ kind: Schema.Literal('too-large'), bytes: count }),
]);

// Each operation's request as configured and the response Observed received
// from the application, or why none arrived. Bodies are recorded after
// credential redaction, so a field named like a credential reads
// "[REDACTED]".
export const api = defineEvidence({
  kind: 'api',
  title: 'API operations',
  schemaVersion: 1,
  collector: {
    operations: Schema.NonEmptyArray(operationSchema).check(
      Schema.isMaxLength(20),
      Schema.makeFilter(
        (operations) =>
          new Set(operations.map((operation) => operation.id)).size ===
          operations.length,
        { message: 'Operation IDs must be unique' },
      ),
    ),
  },
  value: Schema.Struct({
    operations: Schema.Array(
      Schema.Struct({
        request: operationSchema,
        startedAt: timestamp,
        durationMs: count,
        result: Schema.Union([
          Schema.Struct({
            kind: Schema.Literal('response'),
            status: httpStatusSchema,
            headers: Schema.Array(
              Schema.Struct({ name: Schema.String, value: Schema.String }),
            ),
            body: responseBodySchema,
          }),
          Schema.Struct({ kind: Schema.Literal('failed'), reason: nonEmpty }),
        ]),
      }),
    ),
  }),
});

export type OperationRecord =
  (typeof api)['value']['Type']['operations'][number];
