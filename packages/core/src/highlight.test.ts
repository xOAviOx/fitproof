import { describe, expect, it } from "vitest";
import { highlightSegments, locateQuote } from "./highlight";
import { quoteExists } from "./profile";

describe("locateQuote", () => {
  it("finds quotes the verifier accepts, despite case and whitespace differences", () => {
    const text = "Requirements:\n- Strong   Node.js skills.\n- Kafka is a plus.";
    const quote = "strong node.js\nskills.";
    expect(quoteExists(text, quote)).toBe(true);
    const range = locateQuote(text, quote);
    expect(range && text.slice(range.start, range.end)).toBe("Strong   Node.js skills.");
    expect(locateQuote(text, "Invented")).toBeNull();
    expect(locateQuote(text, "   ")).toBeNull();
  });

  it("maps back through characters that NFKC expands", () => {
    const text = "Build eﬃcient APIs";
    const range = locateQuote(text, "efficient");
    expect(range && text.slice(range.start, range.end)).toBe("eﬃcient");
  });
});

describe("highlightSegments", () => {
  it("splits text into runs and keeps overlapping marks", () => {
    const segments = highlightSegments("Must know Node.js and SQL.", [
      { id: "a", quote: "Node.js and SQL" },
      { id: "b", quote: "SQL" },
      { id: "c", quote: "missing" },
    ]);
    expect(segments).toEqual([
      { text: "Must know ", ids: [] },
      { text: "Node.js and ", ids: ["a"] },
      { text: "SQL", ids: ["a", "b"] },
      { text: ".", ids: [] },
    ]);
    expect(segments.map((segment) => segment.text).join("")).toBe("Must know Node.js and SQL.");
  });
});
