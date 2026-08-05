/**
 * T-ADA-1 to T-ADA-5 — the Unit Tests of the conformance suite.
 *
 * One body per requirement, run once per entry of the parameter list. A new agent adds one
 * entry and nothing else (FR-57).
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ALL_ADAPTERS,
  installNetworkTripwire,
  networkAttempts,
  REAL_ADAPTERS,
  restoreNetwork,
} from "./test-support.js";

beforeAll(() => {
  installNetworkTripwire();
});
afterAll(() => {
  restoreNetwork();
  expect(networkAttempts()).toEqual([]);
});

const cases = ALL_ADAPTERS.map((entry) => [entry.id, entry] as const);

describe.each(cases)("T-ADA-1 — %s: capabilities are pure and stable", (_id, entry) => {
  it("returns an equal value on every one of 100 calls", () => {
    const adapter = entry.create();
    const first = adapter.capabilities();
    for (let call = 0; call < 100; call++) {
      expect(adapter.capabilities()).toEqual(first);
    }
  });

  it("answers synchronously", () => {
    const value = entry.create().capabilities() as unknown as { then?: unknown };
    expect(typeof value.then).toBe("undefined");
  });

  it("answers equally from two instances of the same adapter", () => {
    expect(entry.create().capabilities()).toEqual(entry.create().capabilities());
  });
});

describe("T-ADA-2 — the declared agent matches the folder", () => {
  it.each(REAL_ADAPTERS.map((entry) => [entry.id, entry] as const))(
    "%s declares the name of its folder",
    (_id, entry) => {
      expect(entry.create().capabilities().agent).toBe(entry.folder);
    },
  );

  it("has exactly one folder under src/adapters/ per declared agent", async () => {
    const items = await readdir(path.join(import.meta.dirname), { withFileTypes: true });
    const folders = items
      .filter((item) => item.isDirectory())
      .map((item) => item.name)
      .sort();
    const declared = REAL_ADAPTERS.map((entry) => entry.create().capabilities().agent).sort();
    expect(folders).toEqual(declared);
  });

  it("keeps the invented agent out of src/adapters/", async () => {
    const items = await readdir(import.meta.dirname, { withFileTypes: true });
    const invented = ALL_ADAPTERS.filter((entry) => entry.invented);
    expect(invented).toHaveLength(1);
    for (const entry of invented) {
      expect(items.map((item) => item.name)).not.toContain(entry.id);
      expect(entry.folder).toBeNull();
    }
  });
});

describe.each(cases)("T-ADA-3 — %s: the declared default home is absolute", (_id, entry) => {
  it("is an absolute, resolved path (FR-3)", () => {
    const home = entry.create().capabilities().defaultHome;
    expect(path.isAbsolute(home)).toBe(true);
    expect(path.resolve(home)).toBe(home);
  });
});

describe.each(cases)("T-ADA-4 — %s: the declared window is positive", (_id, entry) => {
  it("is greater than 0, so FR-29's budget needs no configuration", () => {
    const tokens = entry.create().capabilities().defaultWindowTokens;
    expect(Number.isInteger(tokens)).toBe(true);
    expect(tokens).toBeGreaterThan(0);
  });
});

describe.each(cases)("T-ADA-5 — %s: at least one role is declared", (_id, entry) => {
  it("declares a non-empty set of source and target only (FR-59)", () => {
    const roles = entry.create().capabilities().roles;
    expect(roles.length).toBeGreaterThan(0);
    expect(new Set(roles).size).toBe(roles.length);
    for (const role of roles) expect(["source", "target"]).toContain(role);
  });
});
