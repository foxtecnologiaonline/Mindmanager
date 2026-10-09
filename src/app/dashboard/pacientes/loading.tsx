export default function PatientsLoading() {
  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-7 w-32 animate-pulse rounded-md bg-border" />
          <div className="h-9 w-32 animate-pulse rounded-md bg-border" />
        </div>
        <div className="card divide-y divide-border">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center justify-between p-4">
              <div className="space-y-1.5">
                <div className="h-4 w-40 animate-pulse rounded bg-border" />
                <div className="h-3 w-28 animate-pulse rounded bg-border/60" />
              </div>
              <div className="h-3 w-16 animate-pulse rounded bg-border/60" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
