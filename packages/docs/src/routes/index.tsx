import { createFileRoute, Link } from '@tanstack/react-router';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';

export const Route = createFileRoute('/')({
  component: Home,
});

function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="flex flex-1 flex-col justify-center gap-4 px-4 py-8 text-center">
        <h1 className="text-xl font-medium">Observed docs</h1>
        <Link
          to="/docs/$"
          params={{ _splat: '' }}
          className="mx-auto rounded-lg bg-fd-primary px-3 py-2 text-sm font-medium text-fd-primary-foreground"
        >
          Read the docs
        </Link>
      </main>
    </HomeLayout>
  );
}
