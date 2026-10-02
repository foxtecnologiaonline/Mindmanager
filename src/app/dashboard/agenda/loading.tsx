export default function AgendaLoading() {
  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-7 w-32 animate-pulse rounded-md bg-border" />
          <div className="h-4 w-48 animate-pulse rounded-md bg-border" />
        </div>
        <div className="h-9 w-full animate-pulse rounded-md bg-border" />
        <div className="card h-[480px] animate-pulse p-4">
          <div className="h-full w-full rounded-md bg-border/60" />
        </div>
      </div>
    </main>
  );
}
