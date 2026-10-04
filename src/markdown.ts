export function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_{}[\]()#+!|~.=-]/g, '\\$&')
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ');
}

export function link(label: string, path: string): string {
  // A pipe would end a Markdown table cell, even inside angle brackets.
  const destination = path.replace(/[<>\s\\|]/g, (character) =>
    encodeURIComponent(character),
  );

  return `[${escapeText(label)}](<${destination}>)`;
}
