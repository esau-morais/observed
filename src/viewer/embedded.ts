import { Schema } from 'effect';

export const embeddedEvidenceId = 'observed-evidence';

const embeddedSchema = Schema.fromJsonString(
  Schema.Record(
    Schema.String,
    Schema.Struct({ type: Schema.String, data: Schema.String }),
  ),
);

export function readEmbeddedEvidence(source: string) {
  const files = Schema.decodeUnknownSync(embeddedSchema)(source);
  const urls = new Map<string, string>();
  let result: unknown = undefined;

  for (const [key, file] of Object.entries(files)) {
    const bytes = Uint8Array.from(atob(file.data), (char) =>
      char.charCodeAt(0),
    );

    if (key === '/result.json') {
      result = JSON.parse(new TextDecoder().decode(bytes));
    } else {
      urls.set(
        key,
        URL.createObjectURL(new Blob([bytes], { type: file.type })),
      );
    }
  }

  if (result === undefined) {
    throw new Error('The report page holds no result.');
  }

  return {
    result,
    resolve: (href: string) =>
      urls.get(new URL(href, 'https://report.invalid/').pathname) ?? href,
  };
}
