const root = import.meta.dirname;

Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.PORT ?? 0),
  fetch(request) {
    const pathname = new URL(request.url).pathname;

    if (pathname.startsWith('/session/') && request.method === 'POST') {
      console.log(JSON.stringify({ method: request.method, path: pathname }));
      const code = decodeURIComponent(pathname.slice('/session/'.length));

      return Response.json(
        { digest: new Bun.CryptoHasher('sha256').update(code).digest('hex') },
        { status: 201 },
      );
    }

    if (pathname === '/') {
      return new Response(Bun.file(`${root}/index.html`));
    }

    return new Response('Not found', { status: 404 });
  },
});

export {};
