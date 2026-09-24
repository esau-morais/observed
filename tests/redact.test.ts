import { expect, test } from 'vitest';
import { redact, redactText } from '../src/redact';

test('redacts URL credentials by decoded key in structured values and log lines', () => {
  const urls = [
    'https://example.test/orders?%74oken=credential&sort=name',
    '/orders?api%5fkey=credential&sort=name',
    'https://credential@example.test/orders?sort=name',
    '/orders?token=safe&%74oken=credential&sort=name',
  ];

  for (const url of urls) {
    expect(redact({ url })).not.toEqual({ url });
    expect(redactText(JSON.stringify({ url }))).not.toContain('credential');
    expect(redactText(`GET ${url} HTTP/1.1`)).not.toContain('credential');
    expect(redactText(JSON.stringify({ url }))).toContain('sort=name');
  }

  const harmless = '/orders?sort=first%20name&sort=last+name';
  expect(redact(harmless)).toBe(harmless);
});

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
