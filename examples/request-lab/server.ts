throw new Error('Seeded start failure for the CI trigger test');

import path from 'node:path';

const root = path.join(import.meta.dirname, 'dist');

Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.PORT ?? 0),
  async fetch(request) {
    const pathname = new URL(request.url).pathname;

    if (pathname === '/api/items') {
      console.log(JSON.stringify({ method: request.method, path: pathname }));

      return Response.json(
        [
          { id: 'notebook', name: 'Notebook' },
          { id: 'pencil', name: 'Pencil' },
          { id: 'ruler', name: 'Ruler' },
        ],
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const filename = path.resolve(
      root,
      pathname === '/' ? 'index.html' : pathname.slice(1),
    );

    if (!filename.startsWith(`${root}${path.sep}`)) {
      return new Response('Not found', { status: 404 });
    }

    const file = Bun.file(filename);

    return (await file.exists())
      ? new Response(file)
      : new Response('Not found', { status: 404 });
  },
});
