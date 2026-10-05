const files = new Set([
  '/gate-3.html',
  '/gate-3-error.js',
  '/gate-3-data.js',
  '/gate-3-error.js.map',
  '/gate-3-data.js.map',
]);
Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.PORT ?? 0),
  fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/favicon.ico') {
      return new Response(null, { status: 204 });
    }

    return files.has(pathname)
      ? new Response(Bun.file(`${import.meta.dirname}/public${pathname}`))
      : new Response('Not found', { status: 404 });
  },
});
export {};
