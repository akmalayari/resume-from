import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REFERENCE_SESSION } from "../../../test/fixtures/reference-session.js";
import type { ProvenanceMarker, SerializedSession, TargetProfile } from "./contract.js";
import { codexAdapterFactory } from "./index.js";
import { makeTempHome } from "./test-support.js";

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

function marker(): ProvenanceMarker {
  return {
    sourceAgent: "codex",
    sourceHome: "/home/testuser/.codex",
    sourceSessionId: "01JQ8Z3K7M4N5P6Q7R8S9T0V1W",
    importedAt: "2026-08-02T10:00:00Z",
    droppedSummary: "dropped 4 result bodies and every reasoning trace",
    lines: ["Imported from codex — /home/testuser/.codex"],
  };
}

function target(home: string): TargetProfile {
  return { agent: "codex", home, windowTokens: 258_400 };
}

/** The landing's job in production (FR-49, FR-53). Here, the test does it. */
function commit(serialized: SerializedSession, mutate: (text: string) => string = (t) => t): void {
  for (const file of serialized.files) {
    mkdirSync(dirname(file.absolutePath), { recursive: true });
    writeFileSync(file.absolutePath, mutate(file.bytes.toString("utf8")));
  }
}

/** T-COD-7 — read-back is the only evidence. */
describe("T-COD-7 read-back is the only evidence", () => {
  it("reports the expected itemCount and openable true after a clean commit", async () => {
    const home = tempHome();
    const serialized = adapter.serialize(REFERENCE_SESSION, target(home), marker());
    commit(serialized);

    const facts = await adapter.readBack(home, serialized.sessionId);
    expect(facts.sessionId).toBe(serialized.sessionId);
    expect(facts.itemCount).toBe(serialized.itemCount);
    expect(facts.openable).toBe(true);
  });

  it("reports a lower itemCount when Codex would drop an unknown item type (C-6)", async () => {
    const home = tempHome();
    const serialized = adapter.serialize(REFERENCE_SESSION, target(home), marker());

    // The write itself succeeds in both cases. Codex validates nothing and says nothing.
    commit(serialized, (text) => {
      const lines = text.split("\n").filter((line) => line !== "");
      const victim = lines.findIndex((line) => line.includes('"agent_message"'));
      lines[victim] = JSON.stringify({
        timestamp: "2026-08-02T10:00:00Z",
        type: "sparkle_entry",
        payload: { message: "an item type this Codex does not know" },
      });
      return lines.map((line) => `${line}\n`).join("");
    });

    const facts = await adapter.readBack(home, serialized.sessionId);
    expect(facts.itemCount).toBe(serialized.itemCount - 1);
    expect(facts.itemCount).toBeLessThan(serialized.itemCount);
    expect(facts.openable).toBe(true);
  });
});

/** T-COD-8 — a missing thread reports rather than throws. */
describe("T-COD-8 a missing thread reports rather than throws", () => {
  it("returns openable false and itemCount 0", async () => {
    const home = tempHome();
    const facts = await adapter.readBack(home, "00000000-0000-4000-8000-000000000000");
    expect(facts).toEqual({
      sessionId: "00000000-0000-4000-8000-000000000000",
      itemCount: 0,
      openable: false,
    });
  });

  it("returns openable false for a home that does not exist", async () => {
    const facts = await adapter.readBack(
      "/nonexistent/codex/home",
      "00000000-0000-4000-8000-000000000000",
    );
    expect(facts.openable).toBe(false);
    expect(facts.itemCount).toBe(0);
  });

  it("returns openable false for a thread cut mid-entry", async () => {
    const home = tempHome();
    const serialized = adapter.serialize(REFERENCE_SESSION, target(home), marker());
    commit(serialized, (text) => text.slice(0, text.length - 30));
    const facts = await adapter.readBack(home, serialized.sessionId);
    expect(facts.openable).toBe(false);
  });

  it("matches the exact filename session id rather than a substring", async () => {
    const home = tempHome();
    const serialized = adapter.serialize(REFERENCE_SESSION, target(home), marker());
    commit(serialized);

    const partialId = serialized.sessionId.slice(0, 12);
    expect(await adapter.readBack(home, partialId)).toEqual({
      sessionId: partialId,
      itemCount: 0,
      openable: false,
    });
  });

  it("rejects stored metadata whose identity differs from the filename", async () => {
    const home = tempHome();
    const serialized = adapter.serialize(REFERENCE_SESSION, target(home), marker());
    commit(serialized, (text) =>
      text.replaceAll(serialized.sessionId, "00000000-0000-4000-8000-000000000000"),
    );

    const facts = await adapter.readBack(home, serialized.sessionId);
    expect(facts.openable).toBe(false);
  });

  it("rejects a stored rollout with an empty user preview", async () => {
    const home = tempHome();
    const serialized = adapter.serialize(REFERENCE_SESSION, target(home), marker());
    commit(serialized, (text) => {
      const lines = text.split("\n");
      return lines
        .map((line) => {
          if (!line.includes('"user_message"')) return line;
          const entry = JSON.parse(line) as { payload: { message: string } };
          entry.payload.message = "   ";
          return JSON.stringify(entry);
        })
        .join("\n");
    });

    const facts = await adapter.readBack(home, serialized.sessionId);
    expect(facts.openable).toBe(false);
  });

  it("does not follow a symlinked sessions subtree", async () => {
    const home = tempHome();
    const outside = tempHome();
    const serialized = adapter.serialize(REFERENCE_SESSION, target(outside), marker());
    commit(serialized);
    symlinkSync(join(outside, "sessions"), join(home, "sessions", "linked"));

    const facts = await adapter.readBack(home, serialized.sessionId);
    expect(facts).toEqual({
      sessionId: serialized.sessionId,
      itemCount: 0,
      openable: false,
    });
  });

  it("propagates a malformed sessions-root error", async () => {
    const home = tempHome();
    const root = join(home, "sessions");
    rmSync(root, { recursive: true, force: true });
    writeFileSync(root, "not a directory");

    await expect(adapter.readBack(home, "00000000-0000-4000-8000-000000000000")).rejects.toThrow(
      /not a directory/,
    );
  });
});

/** T-COD-9 — the switch is refused with a named capability. */
describe("T-COD-9 the switch is refused with a named capability", () => {
  it("rejects with an error naming create-only and the handover command", async () => {
    const home = tempHome();
    const promise = adapter.switchTo(home, "00000000-0000-4000-8000-000000000000", {});
    await expect(promise).rejects.toThrow(/create-only/);
    await expect(promise).rejects.toThrow(/codex resume/);
  });

  it("agrees with the declared landing level", () => {
    expect(adapter.capabilities().landing).toBe("create-only");
  });
});
