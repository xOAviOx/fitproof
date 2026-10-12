import { describe, expect, it, vi } from "vitest";
import { checkHealth } from "./health";

describe("checkHealth", () => {
  it("reports ok when the database answers", async () => {
    const report = await checkHealth(async () => {}, { version: "abc1234" });
    expect(report).toMatchObject({ status: "ok", version: "abc1234", checks: { database: "ok" } });
  });

  it("reports degraded without leaking the error", async () => {
    const onError = vi.fn();
    const report = await checkHealth(
      async () => {
        throw new Error("password authentication failed for user postgres");
      },
      { version: "dev", onError },
    );
    expect(report.status).toBe("degraded");
    expect(JSON.stringify(report)).not.toContain("password");
    expect(onError).toHaveBeenCalledOnce();
  });

  it("times out a hanging database", async () => {
    const report = await checkHealth(() => new Promise(() => {}), { version: "dev", timeoutMs: 20 });
    expect(report.checks.database).toBe("error");
  });
});
