const root = import.meta.dirname;

Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.PORT ?? 0),
  fetch(request) {
    const pathname = new URL(request.url).pathname;

    if (pathname === '/orders' && request.method === 'POST') {
      console.log(JSON.stringify({ method: request.method, path: pathname }));

      return Response.json({ accepted: true }, { status: 201 });
    }

    if (pathname === '/') {
      return new Response(Bun.file(`${root}/index.html`));
    }

    if (pathname === '/app.js') {
      return new Response(Bun.file(`${root}/dist/app.js`));
    }

    return new Response('Not found', { status: 404 });
  },
});

export {};
