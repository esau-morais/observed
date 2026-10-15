import { createFileRoute, Link } from '@tanstack/react-router';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';

export const Route = createFileRoute('/')({
  component: Home,
});

const pages = [
  { slug: 'quickstart', title: 'Quickstart', text: 'Build it from source today.' },
  { slug: 'concepts', title: 'Concepts', text: 'The judge, evidence, unknowns and gaps.' },
  { slug: 'agents', title: 'Agents', text: 'Claude Code, Codex, opencode and Muse.' },
  { slug: 'checks', title: 'Checks', text: 'The kinds, and the rules every check follows.' },
  { slug: 'cli', title: 'CLI', text: 'Every command and flag.' },
  { slug: 'contributing', title: 'Contributing', text: 'Send back a check, a view or an adapter.' },
];

function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-12 px-4 py-16 md:py-24">
        <div className="flex max-w-2xl flex-col gap-5">
          <h1 className="text-5xl font-bold tracking-tight text-balance md:text-6xl">
            Observed docs
          </h1>
          <p className="text-lg text-pretty text-fd-muted-foreground">
            How to run Observed and read what it tells you about your agent&apos;s change. Observed
            is being rebuilt, so some pages describe work in progress and say so.
          </p>
          <Link to="/docs/$" params={{ _splat: '' }} className="lifted self-start">
            Start with the introduction
          </Link>
        </div>
        <ul className="grid gap-1.5 rounded-[20px] bg-fd-muted p-1.5 shadow-[inset_0_1px_2px_rgb(17_19_24/0.1),inset_0_0_0_1px_rgb(17_19_24/0.06)] sm:grid-cols-2 lg:grid-cols-3">
          {pages.map((p) => (
            <li key={p.slug}>
              <Link
                to="/docs/$"
                params={{ _splat: p.slug }}
                className="flex h-full flex-col gap-1 rounded-[14px] bg-fd-card p-5 shadow-[0_0_0_1px_rgb(17_19_24/0.08),0_1px_0_rgb(17_19_24/0.06),0_2px_3px_rgb(17_19_24/0.06)] transition-transform duration-150 ease-out active:scale-[0.98]"
              >
                <span className="font-semibold">{p.title}</span>
                <span className="text-sm text-fd-muted-foreground">{p.text}</span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </HomeLayout>
  );
}
