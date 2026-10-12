import { describe, expect, it } from "vitest";
import { parseWorkerEnv } from "./env";

describe("parseWorkerEnv", () => {
  it("requires a postgres DATABASE_URL", () => {
    expect(() => parseWorkerEnv({})).toThrow(/DATABASE_URL/);
    expect(() => parseWorkerEnv({ DATABASE_URL: "https://example.com" })).toThrow(/DATABASE_URL/);
  });

  it("defaults the log level", () => {
    expect(parseWorkerEnv({ DATABASE_URL: "postgres://u:p@h:5432/db" }).LOG_LEVEL).toBe("info");
  });
});
