export default function DashboardLoading() {
  return (
    <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-10" aria-busy="true">
      <p role="status" className="text-muted-foreground">
        Loading your dashboard…
      </p>
    </main>
  );
}
