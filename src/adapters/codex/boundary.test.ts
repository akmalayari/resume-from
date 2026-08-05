import { readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REFERENCE_SESSION } from "../../../test/fixtures/reference-session.js";
import type { AgentId, ProvenanceMarker, TargetProfile } from "./contract.js";
import { codexAdapterFactory } from "./index.js";
import {
  agentEvent,
  checksumTree,
  functionCall,
  functionCallOutput,
  makeTempHome,
  metaEntry,
  userEvent,
  writeRollout,
} from "./test-support.js";

const adapter = codexAdapterFactory.create();
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const homes: string[] = [];

function tempHome(): string {
  const home = makeTempHome();
  homes.push(home);
  return home;
}

afterEach(() => {
  while (homes.length > 0) {
    const home = homes.pop();
    if (home !== undefined) rmSync(home, { recursive: true, force: true });
  }
});

const MARKER: ProvenanceMarker = {
  sourceAgent: "codex",
  sourceHome: "/home/testuser/.codex",
  sourceSessionId: "01JQ8Z3K7M4N5P6Q7R8S9T0V1W",
  importedAt: "2026-08-02T10:00:00Z",
  droppedSummary: "dropped 4 result bodies and every reasoning trace",
  lines: ["Imported from codex — /home/testuser/.codex"],
};

const SOURCE_ID = "12341234-1234-4234-8234-123412341234";

function sourceHome(): string {
  const home = tempHome();
  writeRollout(home, SOURCE_ID, [
    metaEntry(SOURCE_ID),
    userEvent("make the auth token refresh work"),
    agentEvent("Looking at the token store."),
    functionCall("shell", '{"command":["rg","refreshToken"]}', "c1"),
    functionCallOutput("c1", "a body that must never cross"),
  ]);
  return home;
}

/** The module's own sources: implementation only, no tests, no test helpers. */
function implementationSources(): { name: string; text: string }[] {
  return readdirSync(MODULE_DIR)
    .filter(
      (name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "test-support.ts",
    )
    .map((name) => ({ name, text: readFileSync(join(MODULE_DIR, name), "utf8") }));
}

/** T-COD-10 — the module never writes. */
describe("T-COD-10 the module never writes", () => {
  it("leaves the home byte-identical around serialize and validate", () => {
    const home = sourceHome();
    const before = checksumTree(home);

    const serialized = adapter.serialize(
      REFERENCE_SESSION,
      { agent: "codex", home, windowTokens: 258_400 },
      MARKER,
    );
    expect(adapter.validate(serialized)).toEqual([]);

    expect(checksumTree(home)).toBe(before);
  });

  it("returns the file it wants created instead of creating it (FR-49)", () => {
    const home = tempHome();
    const serialized = adapter.serialize(
      REFERENCE_SESSION,
      { agent: "codex", home, windowTokens: 258_400 },
      MARKER,
    );
    const file = serialized.files[0];
    if (file === undefined) throw new Error("no pending file");
    expect(file.bytes.length).toBeGreaterThan(0);
    expect(readdirSync(join(home, "sessions"))).toEqual([]);
  });
});

/** T-COD-11 — source threads are byte-identical. */
describe("T-COD-11 source threads are byte-identical", () => {
  const agents: AgentId[] = ["pi", "codex", "claude-code"];

  it("leaves every file of the source home untouched after an import into each agent", async () => {
    const home = sourceHome();
    const before = checksumTree(home);

    for (const agent of agents) {
      const descriptors = await adapter.listSessions(home);
      const descriptor = descriptors[0];
      if (descriptor === undefined) throw new Error("no source session");
      const session = await adapter.loadSession(descriptor);
      const targetHome = tempHome();
      const target: TargetProfile = { agent, home: targetHome, windowTokens: 200_000 };
      // Only the Codex adapter can serialize for a Codex target; the other two targets
      // belong to sibling modules. The source-side work under test is the same either way.
      if (agent === "codex")
        expect(adapter.validate(adapter.serialize(session, target, MARKER))).toEqual([]);
    }

    expect(checksumTree(home)).toBe(before);
  });

  it("opens no source file for writing (NG-1, AC-4)", () => {
    for (const source of implementationSources()) {
      expect(source.text).not.toMatch(
        /writeFile|appendFile|createWriteStream|mkdirSync|rmSync|unlinkSync|truncateSync/,
      );
    }
  });
});

/** T-COD-12 — the injection API is never called. */
describe("T-COD-12 the injection API is never called", () => {
  it("has no call site anywhere in the module's sources", () => {
    for (const source of implementationSources()) {
      expect(source.text).not.toContain("inject_items");
      expect(source.text).not.toContain("injectItems");
      expect(source.text).not.toContain("thread/inject");
    }
  });

  it("spawns no process and opens no connection from any source file", () => {
    for (const source of implementationSources()) {
      expect(source.text).not.toContain("node:child_process");
      expect(source.text).not.toContain("node:http");
      expect(source.text).not.toContain("node:net");
      expect(source.text).not.toMatch(/\bfetch\(/);
    }
  });

  it("touches no network during a full read, serialize, validate and read-back cycle", async () => {
    const home = sourceHome();
    const stub = vi.fn(() => {
      throw new Error("the Codex adapter must not open a connection");
    });
    const realFetch = globalThis.fetch;
    globalThis.fetch = stub as unknown as typeof fetch;
    try {
      const descriptors = await adapter.listSessions(home);
      const descriptor = descriptors[0];
      if (descriptor === undefined) throw new Error("no source session");
      const session = await adapter.loadSession(descriptor);
      const serialized = adapter.serialize(
        session,
        { agent: "codex", home, windowTokens: 258_400 },
        MARKER,
      );
      expect(adapter.validate(serialized)).toEqual([]);
      await adapter.readBack(home, serialized.sessionId);
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(stub).not.toHaveBeenCalled();
  });
});
