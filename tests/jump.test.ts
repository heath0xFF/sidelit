import { describe, expect, it } from "vitest";
import { claimJump, claimReveal } from "../src/jump";

describe("claimJump", () => {
  it("claims each jump once per consumer", () => {
    const jump = { nonce: 1, path: "/a.md", text: "x" };
    expect(claimJump(jump, "rich")).toBe(true);
    expect(claimJump(jump, "rich")).toBe(false);
    expect(claimJump(jump, "source")).toBe(true);
    expect(claimJump(undefined, "rich")).toBe(false);
  });
});

describe("claimReveal", () => {
  it("does not replay a reveal when a view remounts", () => {
    expect(claimReveal(0)).toBe(false);
    expect(claimReveal(1)).toBe(true);
    // A remounted editor sees the same counter value.
    expect(claimReveal(1)).toBe(false);
    expect(claimReveal(2)).toBe(true);
  });
});
