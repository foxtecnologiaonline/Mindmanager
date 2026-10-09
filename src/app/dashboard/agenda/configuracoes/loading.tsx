export default function AgendaConfigLoading() {
  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-3xl space-y-8">
        <div className="h-7 w-56 animate-pulse rounded-md bg-border" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-3">
            <div className="h-5 w-40 animate-pulse rounded bg-border" />
            <div className="card h-24 animate-pulse p-4" />
          </div>
        ))}
      </div>
    </main>
  );
}
