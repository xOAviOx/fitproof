import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./env";

const valid = {
  DATABASE_URL: "postgresql://postgres:secret@db.example.supabase.co:6543/postgres",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_0123456789abcdef",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
};

describe("parseServerEnv", () => {
  it("keeps uploads optional but requires a server-only secret when enabled", () => {
    expect(parseServerEnv(valid).RESUME_UPLOADS_ENABLED).toBe(false);
    expect(() => parseServerEnv({ ...valid, RESUME_UPLOADS_ENABLED: "true" })).toThrow(/SUPABASE_SECRET_KEY/);
    expect(
      parseServerEnv({
        ...valid,
        RESUME_UPLOADS_ENABLED: "true",
        SUPABASE_SECRET_KEY: "synthetic-secret-for-unit-tests",
      }).RESUME_UPLOADS_ENABLED,
    ).toBe(true);
  });
  it("accepts a complete config and applies defaults", () => {
    const env = parseServerEnv(valid);
    expect(env.DATABASE_POOL_MAX).toBe(3);
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("names every missing variable without echoing values", () => {
    const attempt = () => parseServerEnv({ DATABASE_URL: "mysql://nope" });
    expect(attempt).toThrow(/DATABASE_URL/);
    expect(attempt).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(attempt).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
    expect(attempt).toThrow(/NEXT_PUBLIC_SITE_URL/);
    expect(attempt).not.toThrow(/mysql:\/\/nope/);
  });
});
