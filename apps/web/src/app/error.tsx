"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4 py-12">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground">
        We couldn't load this page. Try again in a moment.
        {error.digest ? ` If it keeps happening, mention reference ${error.digest}.` : ""}
      </p>
      <Button onClick={reset} className="self-start">
        Try again
      </Button>
    </main>
  );
}
