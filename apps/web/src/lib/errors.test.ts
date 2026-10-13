import { describe, expect, it } from "vitest";
import { databaseErrorCode } from "./errors";

describe("safe database error codes", () => {
  it("walks the cause chain without returning SQL or parameter messages", () => {
    const driver = Object.assign(new Error("sensitive SQL and values"), { code: "42501" });
    expect(databaseErrorCode(new Error("query failed", { cause: driver }))).toBe("42501");
    expect(databaseErrorCode({ code: "secret-password", message: "sensitive" })).toBeUndefined();
    expect(databaseErrorCode(null)).toBeUndefined();
  });
});
