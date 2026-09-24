import { Predicate } from 'effect';

const sensitive =
  /^(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|token|access_token|refresh_token|api[_-]?key|x-api-key)$/i;

function redactString(value: string): string {
  return value
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(
      /([?&](?:token|access_token|refresh_token|api[_-]?key|password|secret)=)[^\s&#"']*/gi,
      '$1[REDACTED]',
    )
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
      typeof value.name === 'string' && sensitive.test(value.name);

    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        sensitive.test(key) ||
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
