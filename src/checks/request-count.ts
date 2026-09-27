import { Schema } from 'effect';
import { httpOriginSchema, routeSchema, text } from '../capture/model';
import { defineCheck, perSide } from './define';

const definition = Schema.Struct({
  kind: Schema.Literal('request-count'),
  id: text,
  name: text,
  scope: text,
  method: text.check(Schema.isPattern(/^[A-Z]+$/)),
  origin: Schema.optionalKey(httpOriginSchema),
  path: routeSchema.check(
    Schema.isPattern(/^[^?#]+$/, {
      message:
        'Request checks match a pathname without query strings or fragments',
    }),
  ),
  expectedCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  status: Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 599 })),
});

export const requestCount = defineCheck({
  definition,
  evidence: [],
  collectors: () => [],
  expectation: (check) =>
    `Exactly ${check.expectedCount} ${check.method} ${check.origin ?? ''}${check.path} request(s) with status ${check.status}.`,
  evaluate: perSide((check, { observations }) => {
    const requests = observations.requests.filter(
      (request) =>
        request.method === check.method &&
        request.path === check.path &&
        request.origin === (check.origin ?? 'application'),
    );
    const successful = requests.every(
      (request) => request.status === check.status,
    );
    const statuses =
      requests.length === 0
        ? 'none'
        : requests.map((request) => request.status).join(', ');

    return {
      outcome:
        requests.length === check.expectedCount && successful
          ? 'passed'
          : 'failed',
      actual: requests.length,
      detail: `Observed ${requests.length} matching ${check.method} ${check.origin ?? ''}${check.path} request(s); statuses: ${statuses}.`,
    };
  }),
});
