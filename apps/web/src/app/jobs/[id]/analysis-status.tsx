"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Status = {
  requirements: string;
  explanation: string | null;
  computedAt: string | null;
  run: string | null;
  error: string | null;
};
const key = (status: Status) => [status.requirements, status.computedAt, status.run, status.error].join("|");

/** Polls while an analysis is queued or running and refreshes the page when it changes. */
export function AnalysisStatus({
  jobId,
  initial,
  rechecking,
}: {
  jobId: string;
  initial: Status;
  rechecking: boolean;
}) {
  const router = useRouter();
  const [disconnected, setDisconnected] = useState(false);
  const [slow, setSlow] = useState(false);
  const last = useRef(key(initial));
  useEffect(() => {
    const controller = new AbortController();
    const started = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - started > 90_000) setSlow(true);
      try {
        const response = await fetch(`/api/jobs/${jobId}/status`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          setDisconnected(true);
          return;
        }
        const data: Status = await response.json();
        setDisconnected(false);
        if (key(data) !== last.current) {
          last.current = key(data);
          router.refresh();
        }
      } catch {
        if (!controller.signal.aborted) setDisconnected(true);
      }
    }, 3000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [jobId, router]);
  return (
    <div
      role="status"
      aria-live="polite"
      className="border-l-2 border-foreground/50 bg-muted/40 px-4 py-3 text-sm"
    >
      <p className="flex items-center gap-2 font-medium">
        <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-foreground" />
        {rechecking ? "Checking again with your current profile" : "Reading the requirements"}
      </p>
      <p className="mt-1 text-muted-foreground">
        {initial.error ??
          (slow
            ? "This is taking longer than usual. You can leave this page; the result will be here when you come back."
            : "This usually takes under a minute. This page updates by itself.")}
      </p>
      {disconnected && (
        <p className="mt-2">Status updates paused. Check your connection or refresh this page.</p>
      )}
    </div>
  );
}
