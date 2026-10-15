import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import appCss from '@/styles/app.css?url';
import { meta } from '@/meta';

export const Route = createRootRoute({
  head: () => ({
    meta,
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: Root,
});

function Root() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
