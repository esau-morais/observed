export function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-3 px-4">
      <p className="font-pixel text-xs tracking-wide text-primary uppercase">Observed</p>
      <h1 className="text-2xl font-semibold tracking-tight">No runs yet.</h1>
      <p className="text-muted-foreground">
        Receipts for your agent&apos;s changes will show up here.
      </p>
    </main>
  );
}
