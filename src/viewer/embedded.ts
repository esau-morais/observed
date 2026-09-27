import { Schema } from 'effect';

export const embeddedEvidenceId = 'observed-evidence';

// The result as plain JSON, so an agent reading the page source finds it.
export const embeddedResultId = 'observed-result';

export const embeddedSchema = Schema.fromJsonString(
  Schema.Record(
    Schema.String,
    Schema.Struct({ type: Schema.String, data: Schema.String }),
  ),
);

export function readEmbeddedEvidence(source: string, resultSource: string) {
  const files = Schema.decodeUnknownSync(embeddedSchema)(source);
  const result = Schema.decodeUnknownSync(
    Schema.fromJsonString(Schema.Unknown),
  )(resultSource);
  const urls = new Map<string, string>([
    [
      '/result.json',
      URL.createObjectURL(
        new Blob([resultSource], { type: 'application/json; charset=utf-8' }),
      ),
    ],
  ]);

  for (const [key, file] of Object.entries(files)) {
    const bytes = Uint8Array.from(atob(file.data), (char) =>
      char.charCodeAt(0),
    );

    urls.set(key, URL.createObjectURL(new Blob([bytes], { type: file.type })));
  }

  return {
    result,
    resolve: (href: string) =>
      urls.get(new URL(href, 'https://report.invalid/').pathname) ?? href,
  };
}
