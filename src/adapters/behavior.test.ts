/**
 * T-ADA-21 and T-ADA-22 — the Behavior Tests of the conformance suite.
 *
 * Both are about the invented fourth agent at `test/fixtures/fixture-agent/`: an agent nobody
 * wrote a rule for, whose declaration alone decides what happens to it. It has no folder under
 * `src/adapters/`, no `module.md`, and `src/host/`'s agent list never holds it — so if anything
 * here worked because of its name, the static check below would find the name.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createFixtureAgentAdapter,
  FIXTURE_FILE_SUFFIX,
} from "../../test/fixtures/fixture-agent/index.js";
import type { SessionDescriptor } from "./contract.js";
import {
  ALL_ADAPTERS,
  cleanupHomes,
  FIXTURE_CASE,
  installNetworkTripwire,
  markerFor,
  networkAttempts,
  REAL_ADAPTERS,
  REFERENCE_SESSION,
  restoreNetwork,
  seedSource,
  targetProfile,
  throwawayHome,
} from "./test-support.js";

beforeAll(() => {
  installNetworkTripwire();
});
afterAll(async () => {
  restoreNetwork();
  expect(networkAttempts()).toEqual([]);
  await cleanupHomes();
});

const srcRoot = path.resolve(import.meta.dirname, "..");

async function sourceFiles(dir: string): Promise<string[]> {
  const items = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const item of items) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) files.push(...(await sourceFiles(full)));
    else if (item.name.endsWith(".ts")) files.push(full);
  }
  return files;
}

describe("T-ADA-21 — a capability decides behaviour, an agent name never does", () => {
  it("is in the conformance suite on the same footing as the three real agents", () => {
    expect(ALL_ADAPTERS).toContain(FIXTURE_CASE);
    expect(ALL_ADAPTERS).toHaveLength(REAL_ADAPTERS.length + 1);
    expect(FIXTURE_CASE.folder).toBeNull();
  });

  it("declares a numbered list and a create-only landing, and is treated accordingly", async () => {
    const adapter = createFixtureAgentAdapter();
    const capabilities = adapter.capabilities();
    expect(capabilities.selection).toBe("numbered-list");
    expect(capabilities.landing).toBe("create-only");

    // FR-45: an agent that cannot move the user hands the command back instead. The suite asks
    // the capability, never the name — the same branch every "create-only" adapter takes.
    const seeded = await seedSource(FIXTURE_CASE, REFERENCE_SESSION);
    expect(FIXTURE_CASE.runtime("switch")).toBeNull();
    await expect(adapter.switchTo(seeded.home, seeded.sessionId, null)).rejects.toThrow(
      /create-only/,
    );
    await expect(adapter.switchTo(seeded.home, seeded.sessionId, null)).rejects.toThrow(
      new RegExp(seeded.sessionId),
    );
  });

  it("uses a format unlike any of the three real agents", async () => {
    const adapter = createFixtureAgentAdapter();
    const home = await throwawayHome("shape-fixture");
    const serialized = adapter.serialize(
      REFERENCE_SESSION,
      targetProfile(adapter, home),
      markerFor(REFERENCE_SESSION),
    );
    const file = serialized.files[0];
    if (file === undefined) throw new Error("the fixture agent serialized nothing");
    expect(file.absolutePath.endsWith(FIXTURE_FILE_SUFFIX)).toBe(true);

    // One whole JSON document, not one JSON object per line: nothing in the tree may assume JSONL.
    const text = file.bytes.toString("utf8");
    expect(text.trim().split("\n").length).toBeGreaterThan(1);
    expect(() => JSON.parse(text)).not.toThrow();

    for (const real of REAL_ADAPTERS) {
      const realAdapter = real.create();
      const realHome = await throwawayHome(`shape-${real.id}`);
      const realFile = realAdapter.serialize(
        REFERENCE_SESSION,
        targetProfile(realAdapter, realHome),
        markerFor(REFERENCE_SESSION),
      ).files[0];
      if (realFile === undefined) throw new Error(`${real.id} serialized nothing`);
      expect(realFile.absolutePath.endsWith(FIXTURE_FILE_SUFFIX)).toBe(false);
      expect(() => JSON.parse(realFile.bytes.toString("utf8"))).toThrow();
    }
  });

  it("is named by no rule, no preview and no adapter under src/ (FR-57, FR-60)", async () => {
    const isTestFile = (file: string): boolean => {
      const name = path.basename(file);
      return name.endsWith(".test.ts") || name === "test-support.ts" || name === "fixtures.ts";
    };

    const production: string[] = [];
    const tests: string[] = [];
    for (const file of await sourceFiles(srcRoot)) {
      const text = await readFile(file, "utf8");
      if (!text.includes("fixture-agent")) continue;
      (isTestFile(file) ? tests : production).push(path.relative(srcRoot, file));
    }

    // No rule, no preview, no host and no adapter implementation knows the agent exists. Tests
    // may name it — that is what a fixture is for, and other modules register it in their own.
    expect(production).toEqual([]);
    expect(tests).toContain("adapters/test-support.ts");

    // And it has no folder of its own in the design tree (T-SES-9 stays true).
    const folders = (await readdir(path.join(srcRoot, "adapters"), { withFileTypes: true }))
      .filter((item) => item.isDirectory())
      .map((item) => item.name);
    expect(folders).not.toContain("fixture-agent");
  });
});

describe("T-ADA-22 — an adapter with one role only", () => {
  it("lists and loads as a source, and refuses every target call by name of the role (FR-59)", async () => {
    // The home is seeded with the two-role fixture; the source-only adapter reads the same format.
    const seeded = await seedSource(FIXTURE_CASE, REFERENCE_SESSION);
    const sourceOnly = createFixtureAgentAdapter({ roles: ["source"] });
    expect(sourceOnly.capabilities().roles).toEqual(["source"]);

    const listed = await sourceOnly.listSessions(seeded.home);
    expect(listed).toHaveLength(1);
    const descriptor = listed[0] as SessionDescriptor;
    const session = await sourceOnly.loadSession(descriptor);
    expect(session.turns.length).toBeGreaterThan(0);

    const home = await throwawayHome("role-target");
    expect(() =>
      sourceOnly.serialize(
        REFERENCE_SESSION,
        targetProfile(sourceOnly, home),
        markerFor(REFERENCE_SESSION),
      ),
    ).toThrow(/target/);
    expect(() => sourceOnly.validate({ sessionId: "x", files: [], itemCount: 0 })).toThrow(
      /target/,
    );
    await expect(sourceOnly.readBack(home, "x")).rejects.toThrow(/target/);
    await expect(sourceOnly.switchTo(home, "x", null)).rejects.toThrow(/target/);
  });

  it("refuses every source call when it declares only the target role (FR-59)", async () => {
    const targetOnly = createFixtureAgentAdapter({ roles: ["target"] });
    expect(targetOnly.capabilities().roles).toEqual(["target"]);

    const home = await throwawayHome("role-source");
    await expect(targetOnly.listSessions(home)).rejects.toThrow(/source/);
    await expect(
      targetOnly.loadSession({
        ref: { agent: targetOnly.capabilities().agent, home, id: "x" },
        title: "",
        startedAt: "",
        updatedAt: "",
        turnCount: 0,
        repoPath: null,
        filePath: path.join(home, `x${FIXTURE_FILE_SUFFIX}`),
      }),
    ).rejects.toThrow(/source/);

    // The half it declares still works, so the refusal is about the role and nothing else.
    const serialized = targetOnly.serialize(
      REFERENCE_SESSION,
      targetProfile(targetOnly, home),
      markerFor(REFERENCE_SESSION),
    );
    expect(targetOnly.validate(serialized)).toEqual([]);
  });
});
