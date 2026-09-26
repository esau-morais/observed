import { expect, test } from 'vitest';
import { requestLedger } from '../src/capture/agent-browser';

// Shapes follow agent-browser 0.38.1 `network requests` output for a login
// form's POST answered by a 302, recorded during a trial capture.
const request = (
  requestId: string,
  method: string,
  path: string,
  status?: number,
) => ({
  requestId,
  method,
  url: new URL(path, 'http://127.0.0.1:4000'),
  ...(status === undefined ? {} : { status }),
});

test.each([
  {
    label: 'a redirected form submission',
    requests: [
      request('A', 'POST', '/login'),
      request('A', 'GET', '/invoices', 200),
      request('B', 'GET', '/style.css', 200),
    ],
    ledger: [
      'GET http://127.0.0.1:4000/invoices 200',
      'GET http://127.0.0.1:4000/style.css 200',
      'POST http://127.0.0.1:4000/login 0',
    ],
  },
  {
    label: 'a request with no status and no redirect after it',
    requests: [request('A', 'GET', '/api/items')],
    ledger: null,
  },
  {
    label: 'a redirect whose target has no status',
    requests: [
      request('A', 'POST', '/login'),
      request('A', 'GET', '/invoices'),
    ],
    ledger: null,
  },
  {
    label: 'a repeated requestId where both requests have a status',
    requests: [
      request('A', 'GET', '/api/items', 200),
      request('A', 'GET', '/api/items', 200),
    ],
    ledger: null,
  },
])('the request ledger for $label', ({ requests, ledger }) => {
  expect(requestLedger(requests)).toEqual(ledger);
});
