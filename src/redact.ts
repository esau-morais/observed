import { Predicate } from 'effect';

const sensitive = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'password',
  'passwd',
  'secret',
  'token',
  'access_token',
  'refresh_token',
  'apikey',
  'api_key',
  'api-key',
  'x-api-key',
]);

function redactUrl(value: string): string {
  const absolute = URL.canParse(value);
  const url = URL.parse(value, 'https://observed.invalid');

  if (url === null || !['http:', 'https:'].includes(url.protocol)) {
    return value;
  }

  let changed = false;

  if (url.username !== '' || url.password !== '') {
    url.username = '[REDACTED]';
    url.password = '';
    changed = true;
  }

  for (const key of new Set(url.searchParams.keys())) {
    if (sensitive.has(key.toLowerCase())) {
      url.searchParams.set(key, '[REDACTED]');
      changed = true;
    }
  }

  if (!changed) {
    return value;
  }

  return absolute ? url.href : `${url.pathname}${url.search}${url.hash}`;
}

function redactString(value: string): string {
  return value
    .replace(/https?:\/\/[^\s<>"']+|[^\s<>"']*\?[^\s<>"']+/gi, redactUrl)
    .replace(
      /((?:authorization|cookie|set-cookie)\s*[:=]\s*)[^\r\n]+/gi,
      '$1[REDACTED]',
    );
}

export function redact(value: unknown, body = false): unknown {
  if (typeof value === 'string') {
    return body ? '[REDACTED]' : redactString(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry: unknown) => redact(entry, body));
  }

  if (Predicate.isObject(value)) {
    const namedSecret =
      typeof value.name === 'string' && sensitive.has(value.name.toLowerCase());

    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        sensitive.has(key.toLowerCase()) ||
        (body && ['text', 'value', 'fileName'].includes(key)) ||
        (key === 'value' && namedSecret)
          ? '[REDACTED]'
          : redact(
              entry,
              key === 'postData' ||
                key === 'cookies' ||
                (body && typeof entry !== 'string'),
            ),
      ]),
    );
  }

  return value;
}

export function redactText(value: string): string {
  try {
    const parsed: unknown = JSON.parse(value);

    return `${JSON.stringify(redact(parsed))}\n`;
  } catch {
    return value
      .split('\n')
      .map((line) => {
        try {
          const parsed: unknown = JSON.parse(line);

          return JSON.stringify(redact(parsed));
        } catch {
          return redactString(line);
        }
      })
      .join('\n');
  }
}
