import { describe, expect, it } from "vitest";
import { canonicalCity, degreeInfo, findCities, findFields, isRemoteWord } from "./terms";

describe("city matching", () => {
  it("recognizes aliases and multi-city location strings", () => {
    expect(canonicalCity("Bangalore")).toBe("Bengaluru");
    expect(canonicalCity("  bengaluru, karnataka, india ")).toBe("Bengaluru");
    expect(canonicalCity("Gurgaon")).toBe("Gurugram");
    expect(findCities("Hyderabad / Pune / Bangalore").sort()).toEqual(["Bengaluru", "Hyderabad", "Pune"]);
  });
  it("returns nothing for unknown places and ambiguous single-city input", () => {
    expect(canonicalCity("Springfield")).toBeNull();
    expect(canonicalCity("Pune or Mumbai")).toBeNull();
    expect(findCities("Remote, India")).toEqual([]);
  });
  it("treats remote words as work mode, not a city", () => {
    expect(isRemoteWord("Remote")).toBe(true);
    expect(isRemoteWord("work from home")).toBe(true);
    expect(isRemoteWord("Pune")).toBe(false);
  });
});

describe("degree and branch matching", () => {
  it("maps common Indian degree spellings to one key and level", () => {
    for (const text of ["B.Tech", "BTech in CSE", "B.E.", "Bachelor of Engineering (Computer)"]) {
      expect(degreeInfo(text)).toEqual({ keys: ["btech"], level: "bachelor" });
    }
    expect(degreeInfo("MCA")).toEqual({ keys: ["mca"], level: "master" });
    expect(degreeInfo("Bachelor's degree")).toEqual({ keys: [], level: "bachelor" });
    expect(degreeInfo("Something else")).toEqual({ keys: [], level: null });
    expect(degreeInfo(null)).toEqual({ keys: [], level: null });
  });
  it("prefers the longest branch alias so similar names stay distinct", () => {
    expect(findFields("Electrical and Electronics Engineering")).toEqual(["electrical"]);
    expect(findFields("Electronics & Communication")).toEqual(["electronics"]);
    expect(findFields("CSE")).toEqual(["computer_science"]);
    expect(findFields("Information Science and Engineering")).toEqual(["information_technology"]);
    expect(findFields("CS/IT").sort()).toEqual(["computer_science", "information_technology"]);
    expect(findFields("Fine arts")).toEqual([]);
  });
});
