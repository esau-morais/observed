// Usage: bun serve.ts PORT VIEWER_DIST REPORT_DIR...
// Serves each report at /<n>/ with the given viewer build instead of the
// viewer the report was written with. Development use only.
import path from 'node:path';
const [port, viewer, ...reports] = process.argv.slice(2);
Bun.serve({
  port: Number(port),
  async fetch(request) {
    const url = new URL(request.url);
    const [, slot, ...rest] = url.pathname.split('/');
    const report = reports[Number(slot)];
    if (report === undefined) return new Response('reports: ' + reports.join(', '), { status: 404 });
    const name = decodeURIComponent(rest.join('/')) || 'index.html';
    const fromViewer = name === 'index.html' || name.startsWith('assets/');
    const file = Bun.file(path.join(fromViewer ? viewer! : report, name));
    return (await file.exists()) ? new Response(file) : new Response('missing ' + name, { status: 404 });
  },
});
console.log(`serving ${reports.length} reports on ${port}`);
