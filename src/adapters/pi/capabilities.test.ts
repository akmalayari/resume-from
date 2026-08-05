import { isAbsolute } from "node:path";
import { describe, expect, it } from "vitest";
import { piAdapterFactory } from "./index.js";

describe("T-PI-1 — capabilities are as designed", () => {
  const capabilities = piAdapterFactory.create().capabilities();

  it("declares Pi's agent id and both roles", () => {
    expect(capabilities.agent).toBe("pi");
    expect([...capabilities.roles].sort()).toEqual(["source", "target"]);
  });

  it("declares the two abilities C-10 measured", () => {
    expect(capabilities.selection).toBe("interactive-picker");
    expect(capabilities.landing).toBe("create-and-switch");
  });

  it("declares an out-of-context provenance entry", () => {
    expect(capabilities.provenance).toBe("out-of-context-entry");
  });

  it("declares an absolute default home and a positive window", () => {
    expect(isAbsolute(capabilities.defaultHome)).toBe(true);
    expect(capabilities.defaultWindowTokens).toBeGreaterThan(0);
  });
});
