import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: Home,
});

function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-4 py-16">
      <p className="font-pixel text-xs tracking-wide text-blue uppercase">Observed</p>
      <h1 className="text-4xl font-semibold tracking-tight text-balance">
        See what your agent&apos;s change actually did.
      </h1>
      <p className="text-lg text-pretty text-ink/70">
        Run any coding agent and get pictures and a plain-text receipt of what changed in your app.
        Checks written before the change decide what holds. No model gets a vote.
      </p>
      <a
        className="font-mono text-sm text-blue underline underline-offset-4"
        href="https://github.com/esau-morais/observed"
      >
        github.com/esau-morais/observed
      </a>
    </main>
  );
}
