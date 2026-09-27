export function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_{}[\]()#+!|~.=-]/g, '\\$&')
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ');
}
