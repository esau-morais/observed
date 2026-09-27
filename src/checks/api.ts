import { Schema } from 'effect';
import { text as nonEmpty } from '../capture/model';
import type { CollectorConfig } from '../evidence-kinds';
import {
  httpStatusSchema,
  type OperationRecord as Recorded,
} from '../evidence-kinds/api';
import {
  isJsonObject,
  jsonEqual,
  jsonPointerSchema,
  jsonSchema,
  resolvePointer,
  validateJson,
} from '../json-schema';
import { defineCheck, perSide, type Evaluation } from './define';

type Response = Extract<Recorded['result'], { kind: 'response' }>;

const identity = {
  id: nonEmpty,
  name: nonEmpty,
  scope: nonEmpty,
  operation: nonEmpty,
};

function configured(collectors: readonly CollectorConfig[]) {
  return (
    collectors.find(
      (collector): collector is CollectorConfig<'api'> =>
        collector.kind === 'api',
    )?.operations ?? []
  );
}

function missingOperations(
  check: { readonly id: string },
  names: readonly string[],
  collectors: readonly CollectorConfig[],
): string[] {
  const listed = new Set(configured(collectors).map((item) => item.id));

  return names
    .filter((name) => !listed.has(name))
    .map(
      (name) =>
        `Check ${check.id} names operation ${name}, which the api collector does not list`,
    );
}

// A step towards a verdict: the value it needs, or the evaluation that
// settles the check without it.
type Settled = { kind: 'settled'; evaluation: Evaluation };
type Found<T> = { kind: 'found'; value: T } | Settled;

const unknown = (detail: string): Settled => ({
  kind: 'settled',
  evaluation: { outcome: 'unknown', actual: null, detail },
});

type Answered = { response: Response; request: string };

function response(
  operations: readonly Recorded[],
  id: string,
): Found<Answered> {
  const recorded = operations.find((item) => item.request.id === id);

  if (recorded === undefined) {
    return unknown(`Operation ${id} was not recorded.`);
  }

  const request = `${recorded.request.method} ${recorded.request.path}`;

  return recorded.result.kind === 'failed'
    ? unknown(`${request}: ${recorded.result.reason}.`)
    : { kind: 'found', value: { response: recorded.result, request } };
}

export const apiStatus = defineCheck({
  definition: Schema.Struct({
    kind: Schema.Literal('api-status'),
    ...identity,
    status: httpStatusSchema,
  }),
  evidence: ['api'],
  collectors: () => [],
  validate: (check, collectors) =>
    missingOperations(check, [check.operation], collectors),
  expectation: (check) =>
    `Operation ${check.operation} answers with status ${check.status}.`,
  evaluate: perSide((check, { evidence }) => {
    const found = response(evidence.api.operations, check.operation);

    if (found.kind === 'settled') {
      return found.evaluation;
    }

    const { request, response: answer } = found.value;

    return answer.status === check.status
      ? {
          outcome: 'passed',
          actual: answer.status,
          detail: `${request} answered ${answer.status}.`,
        }
      : {
          outcome: 'failed',
          actual: answer.status,
          detail: `${request} answered ${answer.status}, expected ${check.status}.`,
        };
  }),
});

// Credential-named fields and echoed environment values are redacted before
// evidence is written, so the recorded value is not what the app sent.
function holdsRedaction(value: Schema.Json): boolean {
  if (typeof value === 'string') {
    return value.includes('[REDACTED]');
  }

  if (Array.isArray(value)) {
    const items: readonly Schema.Json[] = value;

    return items.some(holdsRedaction);
  }

  return isJsonObject(value) && Object.values(value).some(holdsRedaction);
}

function describeIssues(issues: readonly string[]): string {
  const shown = issues.slice(0, 5).join('; ');

  return issues.length > 5 ? `${shown}; and ${issues.length - 5} more` : shown;
}

// A body that is not JSON fails a JSON expectation; one too large to record
// leaves it unknown.
function jsonBody({ request, response: answer }: Answered): Found<Schema.Json> {
  const body = answer.body;

  switch (body.kind) {
    case 'json':
      return { kind: 'found', value: body.value };
    case 'too-large':
      return unknown(
        `${request}: the body, ${body.bytes} bytes or more, was too large to record.`,
      );
    case 'text':
    case 'empty':
      return {
        kind: 'settled',
        evaluation: {
          outcome: 'failed',
          actual: body.kind === 'empty' ? 'empty body' : 'not JSON',
          detail: `${request} answered ${answer.status} with ${body.kind === 'empty' ? 'an empty body' : 'a body that is not JSON'}.`,
        },
      };
  }
}

export const apiSchema = defineCheck({
  definition: Schema.Struct({
    kind: Schema.Literal('api-schema'),
    ...identity,
    schema: jsonSchema,
  }),
  evidence: ['api'],
  collectors: () => [],
  validate: (check, collectors) =>
    missingOperations(check, [check.operation], collectors),
  expectation: (check) =>
    `The JSON body of operation ${check.operation} matches the check's schema.`,
  evaluate: perSide((check, { evidence }) => {
    const found = response(evidence.api.operations, check.operation);

    if (found.kind === 'settled') {
      return found.evaluation;
    }

    const body = jsonBody(found.value);

    if (body.kind === 'settled') {
      return body.evaluation;
    }

    if (holdsRedaction(body.value)) {
      return unknown(
        `${found.value.request}: Observed redacted values in the body, so it can't check them against the schema.`,
      ).evaluation;
    }

    const issues = validateJson(check.schema, body.value);
    const { request, response: answer } = found.value;

    return issues.length === 0
      ? {
          outcome: 'passed',
          actual: 0,
          detail: `${request} answered ${answer.status} with a body that matches the schema.`,
        }
      : {
          outcome: 'failed',
          actual: issues.length,
          detail: `${request} answered ${answer.status}; ${issues.length} schema violation(s): ${describeIssues(issues)}.`,
        };
  }),
});

export const apiReadback = defineCheck({
  definition: Schema.Struct({
    kind: Schema.Literal('api-readback'),
    ...identity,
    readback: nonEmpty,
    pointer: jsonPointerSchema,
    expected: Schema.Json,
  }),
  evidence: ['api'],
  collectors: () => [],
  validate: (check, collectors) => {
    const missing = missingOperations(
      check,
      [check.operation, check.readback],
      collectors,
    );
    const ids = configured(collectors).map((item) => item.id);

    return missing.length === 0 &&
      ids.indexOf(check.readback) <= ids.indexOf(check.operation)
      ? [
          `Check ${check.id} reads back with ${check.readback}, which must come after ${check.operation} in the api collector's operations`,
        ]
      : missing;
  },
  expectation: (check) =>
    `Operation ${check.operation} succeeds, then operation ${check.readback} returns ${JSON.stringify(check.expected)} at ${check.pointer === '' ? 'the body root' : check.pointer}.`,
  evaluate: perSide((check, { evidence }) => {
    const write = response(evidence.api.operations, check.operation);

    if (write.kind === 'settled') {
      return write.evaluation;
    }

    const written = `${write.value.request} answered ${write.value.response.status}`;

    if (
      write.value.response.status < 200 ||
      write.value.response.status > 299
    ) {
      return {
        outcome: 'failed',
        actual: `write answered ${write.value.response.status}`,
        detail: `${written}, so there is no side effect to read back.`,
      };
    }

    const read = response(evidence.api.operations, check.readback);

    if (read.kind === 'settled') {
      return read.evaluation;
    }

    const body = jsonBody(read.value);

    if (body.kind === 'settled') {
      return body.evaluation;
    }

    const value = resolvePointer(body.value, check.pointer);
    const location = check.pointer === '' ? 'the body root' : check.pointer;
    const readRequest = read.value.request;

    if (value !== undefined && holdsRedaction(value)) {
      return unknown(
        `${readRequest}: Observed redacted the value at ${location}, so it can't compare it.`,
      ).evaluation;
    }

    if (value === undefined) {
      return {
        outcome: 'failed',
        actual: `nothing at ${location}`,
        detail: `${written}; ${readRequest} answered ${read.value.response.status} with nothing at ${location}.`,
      };
    }

    const actual = JSON.stringify(value);

    return jsonEqual(value, check.expected)
      ? {
          outcome: 'passed',
          actual,
          detail: `${written}; ${readRequest} returned ${actual} at ${location}.`,
        }
      : {
          outcome: 'failed',
          actual,
          detail: `${written}; ${readRequest} returned ${actual} at ${location}, expected ${JSON.stringify(check.expected)}.`,
        };
  }),
});
