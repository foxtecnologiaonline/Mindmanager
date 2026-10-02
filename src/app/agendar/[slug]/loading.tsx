export default function BookingLoading() {
  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-lg space-y-6">
        <div className="h-7 w-40 animate-pulse rounded-md bg-border" />
        <div className="card h-80 animate-pulse p-6">
          <div className="h-full w-full rounded-md bg-border/60" />
        </div>
      </div>
    </main>
  );
}
