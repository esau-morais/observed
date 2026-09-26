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
  const url = URL.parse(value, 'https://observed.invalid');

  if (url === null || (url.username === '' && url.password === '')) {
    return value;
  }

  url.username = '[REDACTED]';
  url.password = '';

  return value.startsWith('//')
    ? url.href.slice(url.protocol.length)
    : url.href;
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
    .replace(/(?:https?:)?\/\/[^\s<>"']+/gi, redactUserInfo)
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

export function redactText(
  value: string,
  known: readonly string[] = [],
): string {
  const input = conceal(value, known);

  try {
    const parsed: unknown = JSON.parse(input);

    return conceal(`${JSON.stringify(redact(parsed))}\n`, known);
  } catch {
    return conceal(
      input
        .split('\n')
        .map((line) => {
          try {
            const parsed: unknown = JSON.parse(line);

            return JSON.stringify(redact(parsed));
          } catch {
            return redactString(line);
          }
        })
        .join('\n'),
      known,
    );
  }
}

// agent-browser echoes batch input as JSON, and pages can send a value in a
// path, a query string, or a form body.
export function conceal(value: string, secrets: readonly string[]): string {
  const forms = secrets
    .flatMap((secret) => [
      secret,
      JSON.stringify(secret).slice(1, -1),
      encodeURIComponent(secret),
      encodeURI(secret),
      new URLSearchParams([['', secret]]).toString().slice(1),
    ])
    .filter((form) => form !== '')
    .sort((left, right) => right.length - left.length);

  return forms.reduce(
    (text, form) => text.replaceAll(form, '[REDACTED]'),
    value,
  );
}
