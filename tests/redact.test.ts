import { expect, test } from 'vitest';
import { redactText } from '../src/redact';

test('redacts credential maps, HAR header/query pairs and bodies while retaining request evidence', () => {
  const input = {
    url: 'https://alice:secret@example.test/orders?token=credential&sort=name',
    headers: [
      { name: 'Authorization', value: 'Bearer credential' },
      { name: 'Accept', value: 'application/json' },
    ],
    responseHeaders: {
      'set-cookie': 'session=credential',
      'content-type': 'application/json',
    },
    queryString: [{ name: 'api_key', value: 'credential' }],
    postData: { mimeType: 'application/json', text: 'credential' },
    cookies: [{ name: 'session', value: 'credential' }],
    method: 'POST',
    status: 201,
  };
  const result = redactText(JSON.stringify(input));

  expect(result).not.toMatch(/credential|secret|alice/);
  expect(result).toContain('sort=name');
  expect(result).toContain('application/json');
  expect(result).toContain('"status":201');
  expect(result).toContain(
    '"postData":{"mimeType":"application/json","text":"[REDACTED]"}',
  );
});

test('redacts line-oriented output as well as valid JSON', () => {
  expect(
    redactText(
      'Authorization: Bearer credential\nGET /orders?token=credential\n',
    ),
  ).not.toContain('credential');
});

test('redacts each JSON log record in a mixed output stream', () => {
  const result = redactText(
    'ready\n{"token":"sensitive-value"}\n{"ready":true}\n',
  );

  expect(result).not.toContain('sensitive-value');
  expect(result).toContain('"ready":true');
});
