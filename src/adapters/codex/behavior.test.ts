import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProvenanceMarker, SerializedSession } from "./contract.js";
import { codexAdapterFactory } from "./index.js";
import type { RolloutEntry } from "./rollout.js";
import {
  agentEvent,
  checksumTree,
  functionCall,
  functionCallOutput,
  makeTempHome,
  metaEntry,
  reasoningItem,
  userEvent,
  writeRollout,
} from "./test-support.js";

const adapter = codexAdapterFactory.create();
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
  droppedSummary: "dropped every result body and every reasoning trace",
  lines: ["Imported from codex — /home/testuser/.codex"],
};

function commit(serialized: SerializedSession): void {
  for (const file of serialized.files) {
    mkdirSync(dirname(file.absolutePath), { recursive: true });
    writeFileSync(file.absolutePath, file.bytes);
  }
}

/** T-COD-18 — Codex to Codex across homes. */
describe("T-COD-18 Codex to Codex across homes", () => {
  const id = "abcdabcd-abcd-4bcd-8bcd-abcdabcdabcd";
  const OUTPUT_BODY = "a tool result body that must never cross homes";

  it("leaves both homes in place, lists and opens the target, and carries no output body", async () => {
    const source = tempHome();
    writeRollout(source, id, [
      metaEntry(id),
      userEvent("make the auth token refresh work"),
      agentEvent("Looking at the token store."),
      functionCall("shell", '{"command":["rg","refreshToken"]}', "c1"),
      functionCallOutput("c1", OUTPUT_BODY),
      agentEvent("Fixed the write path."),
    ]);
    const sourceChecksum = checksumTree(source);
    const targetHome = tempHome();

    const descriptors = await adapter.listSessions(source);
    const descriptor = descriptors[0];
    if (descriptor === undefined) throw new Error("no source session");
    const session = await adapter.loadSession(descriptor);
    const serialized = adapter.serialize(
      session,
      { agent: "codex", home: targetHome, windowTokens: 258_400 },
      MARKER,
    );
    expect(adapter.validate(serialized)).toEqual([]);
    commit(serialized);

    // The source home is untouched, and still lists exactly what it did before (FR-4).
    expect(checksumTree(source)).toBe(sourceChecksum);
    expect((await adapter.listSessions(source)).map((d) => d.ref.id)).toEqual([id]);

    // The target home now lists and opens the imported thread.
    const landed = await adapter.listSessions(targetHome);
    expect(landed.map((d) => d.ref.id)).toEqual([serialized.sessionId]);
    expect(landed[0]?.title).toBe("make the auth token refresh work");
    const facts = await adapter.readBack(targetHome, serialized.sessionId);
    expect(facts.openable).toBe(true);
    expect(facts.itemCount).toBe(serialized.itemCount);

    // No result body crossed (FR-24).
    const file = serialized.files[0];
    if (file === undefined) throw new Error("no pending file");
    expect(file.bytes.toString("utf8")).not.toContain(OUTPUT_BODY);
  });

  it("keeps the two homes independent — the source id is not reused", async () => {
    const source = tempHome();
    writeRollout(source, id, [metaEntry(id), userEvent("hello"), agentEvent("hi")]);
    const targetHome = tempHome();
    const descriptors = await adapter.listSessions(source);
    const descriptor = descriptors[0];
    if (descriptor === undefined) throw new Error("no source session");
    const session = await adapter.loadSession(descriptor);
    const serialized = adapter.serialize(
      session,
      { agent: "codex", home: targetHome, windowTokens: 258_400 },
      MARKER,
    );
    expect(serialized.sessionId).not.toBe(id);
  });
});

/** T-COD-19 — a large session still fits. */
describe("T-COD-19 a large session still fits", () => {
  const id = "dcbadcba-dcba-4cba-8cba-dcbadcbadcba";

  /** C-5's measured shape: ~10% visible conversation, ~41% reasoning, ~49% calls and outputs. */
  function c5Shaped(): RolloutEntry[] {
    const entries: RolloutEntry[] = [metaEntry(id), userEvent("make the auth token refresh work")];
    for (let turn = 0; turn < 40; turn += 1) {
      entries.push(agentEvent(`Step ${turn}: ${"visible answer text. ".repeat(20)}`));
      entries.push(reasoningItem("ENCRYPTED-REASONING-".repeat(430)));
      entries.push(functionCall("shell", `{"command":["rg","token-${turn}"]}`, `c${turn}`));
      entries.push(
        functionCallOutput(`c${turn}`, `RESULT-BODY-${turn} ${"output line\n".repeat(420)}`),
      );
    }
    return entries;
  }

  it("crosses only the visible conversation, so the import fits the budget (AC-5)", async () => {
    const home = tempHome();
    const path = writeRollout(home, id, c5Shaped());
    const sourceBytes = statSync(path).size;

    const descriptors = await adapter.listSessions(home);
    const descriptor = descriptors[0];
    if (descriptor === undefined) throw new Error("no source session");
    const session = await adapter.loadSession(descriptor);
    const windowTokens = 258_400;
    const serialized = adapter.serialize(
      session,
      { agent: "codex", home: tempHome(), windowTokens },
      MARKER,
    );
    const file = serialized.files[0];
    if (file === undefined) throw new Error("no pending file");

    // The 90% that is reasoning and result bodies never crosses.
    expect(file.bytes.length).toBeLessThan(sourceBytes * 0.2);
    const text = file.bytes.toString("utf8");
    expect(text).not.toContain("ENCRYPTED-REASONING-");
    expect(text).not.toContain("RESULT-BODY-");

    // Rough estimate only — the real budget lives in src/platform/tokens/.
    // Four characters per token is the documented heuristic; the import must leave room to work.
    const estimatedTokens = text.length / 4;
    expect(estimatedTokens).toBeLessThan(windowTokens * 0.5);
  });
});
