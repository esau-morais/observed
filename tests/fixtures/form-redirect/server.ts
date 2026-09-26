Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.PORT ?? 0),
  async fetch(request) {
    const pathname = new URL(request.url).pathname;

    if (pathname === '/session' && request.method === 'POST') {
      const name = (await request.formData()).get('name');

      return new Response(null, {
        status: 303,
        headers: {
          location: `/welcome?name=${encodeURIComponent(typeof name === 'string' ? name : '')}`,
        },
      });
    }

    if (pathname === '/welcome') {
      const name = new URL(request.url).searchParams.get('name') ?? '';

      return new Response(
        `<!doctype html><title>Welcome</title><p role="status">Welcome, ${name.replace(/[^a-z]/gi, '')}</p>`,
        { headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    }

    if (pathname === '/') {
      return new Response(
        '<!doctype html><title>Sign in</title><form method="post" action="/session"><label for="name">Name</label><input id="name" name="name"><button type="submit">Sign in</button></form>',
        { headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    }

    return new Response('Not found', { status: 404 });
  },
});

export {};
