const root = import.meta.dirname;

Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.PORT ?? 0),
  fetch(request) {
    const pathname = new URL(request.url).pathname;

    if (pathname === '/api/items') {
      return Response.json(['one']);
    }

    if (pathname === '/favicon.ico') {
      return new Response(null, { status: 204 });
    }

    const files: Record<string, string> = {
      '/': 'index.html',
      '/counts.js': 'public/counts.js',
      '/counts.js.map': 'public/counts.js.map',
    };
    const filename = files[pathname];

    return filename === undefined
      ? new Response('Not found', { status: 404 })
      : new Response(Bun.file(`${root}/${filename}`));
  },
});

export {};
