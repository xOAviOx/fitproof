import { describe, expect, it } from "vitest";
import { isProtectedPath } from "./routes";

describe("isProtectedPath", () => {
  it.each(["/dashboard", "/dashboard/x", "/admin", "/tracker"])("protects %s", (path) => {
    expect(isProtectedPath(path)).toBe(true);
  });

  it.each(["/", "/login", "/auth/callback", "/api/health", "/dashboards", "/jobsearch"])(
    "leaves %s public",
    (path) => {
      expect(isProtectedPath(path)).toBe(false);
    },
  );
});
