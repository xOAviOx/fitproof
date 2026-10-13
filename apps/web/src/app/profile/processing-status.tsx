"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function ProcessingStatus({ status, error }: { status: string; error: string | null }) {
  const router = useRouter();
  const [disconnected, setDisconnected] = useState(false);
  const pending = status === "uploaded" || status === "extracting";
  useEffect(() => {
    if (!pending) return;
    const controller = new AbortController();
    const timer = setInterval(async () => {
      try {
        const response = await fetch("/api/profile/status", { cache: "no-store", signal: controller.signal });
        if (!response.ok) {
          setDisconnected(true);
          return;
        }
        const data: { status: string | null; error: string | null } = await response.json();
        setDisconnected(false);
        if (data.status !== status || data.error !== error) router.refresh();
      } catch {
        if (!controller.signal.aborted) setDisconnected(true);
      }
    }, 4000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [pending, status, error, router]);
  if (status === "extracted") return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="border-l-2 border-foreground/50 bg-muted/40 px-4 py-3 text-sm"
    >
      <p className="font-medium">
        {status === "failed"
          ? "This résumé needs attention"
          : status === "extracting"
            ? "Reading your résumé"
            : "Queued for extraction"}
      </p>
      <p className="mt-1 text-muted-foreground">
        {error ??
          "Background processing can take several minutes. Your draft will appear here automatically."}
      </p>
      {disconnected && (
        <p className="mt-2">Status updates paused. Check your connection or refresh this page.</p>
      )}
    </div>
  );
}
