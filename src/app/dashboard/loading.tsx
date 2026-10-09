export default function DashboardLoading() {
  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="h-24 animate-pulse rounded-2xl bg-border/60" />
        <div className="card h-28 animate-pulse p-5">
          <div className="h-full w-full rounded-md bg-border/40" />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="card h-20 animate-pulse p-4" />
          <div className="card h-20 animate-pulse p-4" />
          <div className="card h-20 animate-pulse p-4" />
        </div>
      </div>
    </main>
  );
}
