export type HealthReport = {
  status: "ok" | "degraded";
  version: string;
  checks: { database: "ok" | "error" };
  time: string;
};

const TIMEOUT = Symbol("timeout");

/** Never includes error details in the report; failures are logged by the caller. */
export async function checkHealth(
  pingDatabase: () => Promise<void>,
  options: { version: string; timeoutMs?: number; onError?: (error: unknown) => void },
): Promise<HealthReport> {
  let database: "ok" | "error" = "ok";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<typeof TIMEOUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMEOUT), options.timeoutMs ?? 3000);
    });
    const outcome = await Promise.race([pingDatabase(), timeout]);
    if (outcome === TIMEOUT) throw new Error("database ping timed out");
  } catch (error) {
    database = "error";
    options.onError?.(error);
  } finally {
    clearTimeout(timer);
  }
  return {
    status: database === "ok" ? "ok" : "degraded",
    version: options.version,
    checks: { database },
    time: new Date().toISOString(),
  };
}
