import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-redirect";

describe("safeNextPath", () => {
  it.each([
    ["/dashboard", "/dashboard"],
    ["/jobs?band=strong#top", "/jobs?band=strong#top"],
  ])("keeps same-site path %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "dashboard",
    "",
    null,
    undefined,
    42,
    `/${"a".repeat(600)}`,
  ])("falls back for unsafe value %s", (input) => {
    expect(safeNextPath(input)).toBe("/dashboard");
  });
});
