export default function JobLoading() {
  return (
    <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-10" aria-busy="true">
      <p role="status" className="text-sm text-muted-foreground">
        Loading this job…
      </p>
    </main>
  );
}
