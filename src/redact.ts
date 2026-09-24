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

function redactUserInfo(value: string): string {
  const url = URL.parse(value);

  if (url === null || (url.username === '' && url.password === '')) {
    return value;
  }

  url.username = '[REDACTED]';
  url.password = '';

  return url.href;
}

function redactQuery(value: string): string {
  return value
    .split('#')
    .map((part) => {
      const start = part.indexOf('?');

      if (start === -1) {
        return part;
      }

      const query = new URLSearchParams(part.slice(start + 1));
      let changed = false;

      for (const key of new Set(query.keys())) {
        if (sensitive.has(key.toLowerCase())) {
          query.set(key, '[REDACTED]');
          changed = true;
        }
      }

      return changed ? `${part.slice(0, start + 1)}${query.toString()}` : part;
    })
    .join('#');
}

function redactString(value: string): string {
  return value
    .replace(/https?:\/\/[^\s<>"']+/gi, redactUserInfo)
    .replace(/[^\s<>"']*\?[^\s<>"']*/g, redactQuery)
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
