import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { REFERENCE_SESSION } from "../../../test/fixtures/reference-session.js";
import { createClaudeCodeAdapter } from "./adapter.js";
import type { ProvenanceMarker, TargetProfile } from "./contract.js";
import { cleanupThrowaways, commitPendingFiles, makeThrowawayHome } from "./test-support.js";

const REPO = "/work/app";

const MARKER: ProvenanceMarker = {
  sourceAgent: "codex",
  sourceHome: "/home/testuser/.codex",
  sourceSessionId: REFERENCE_SESSION.provenance.ref.id,
  importedAt: "2026-08-02T10:00:00.000Z",
  droppedSummary: "3 tool result bodies dropped",
  lines: ["Imported from codex", "3 tool result bodies dropped"],
};

afterEach(async () => {
  await cleanupThrowaways();
});

describe("T-CC-6 — read-back reports what the store holds", () => {
  it("counts what the store holds and reports the session as openable (FR-51, FR-52)", async () => {
    const home = await makeThrowawayHome();
    const target: TargetProfile = { agent: "claude-code", home, windowTokens: 200_000 };
    const adapter = createClaudeCodeAdapter({ cwd: REPO });

    const serialized = adapter.serialize(REFERENCE_SESSION, target, MARKER);
    expect(adapter.validate(serialized)).toEqual([]);
    await commitPendingFiles(serialized.files);

    const facts = await adapter.readBack(home, serialized.sessionId);
    expect(facts.sessionId).toBe(serialized.sessionId);
    expect(facts.itemCount).toBe(serialized.itemCount);
    expect(facts.openable).toBe(true);

    const lines = (await readFile(serialized.files[0]?.absolutePath as string, "utf8"))
      .split("\n")
      .filter((line) => line.trim() !== "");
    expect(facts.itemCount).toBe(lines.length);
  });

  it("finds the session again as a source, so the imported turns are readable (FR-41)", async () => {
    const home = await makeThrowawayHome();
    const target: TargetProfile = { agent: "claude-code", home, windowTokens: 200_000 };
    const adapter = createClaudeCodeAdapter({ cwd: REPO });
    const serialized = adapter.serialize(REFERENCE_SESSION, target, MARKER);
    await commitPendingFiles(serialized.files);

    const listed = await adapter.listSessions(home);
    expect(listed.map((descriptor) => descriptor.ref.id)).toEqual([serialized.sessionId]);
    const reloaded = await adapter.loadSession(listed[0] as never);
    const visible = reloaded.turns.map((turn) => turn.text).join("\n");
    expect(visible).toContain("make the auth token refresh work");
    expect(visible).toContain("inject the clock, don't mock the whole module");
    expect(visible).toContain("Read('src/auth.ts')");
  });
});

describe("T-CC-7 — a missing session reports rather than throws", () => {
  it("reports a session that is not in the home", async () => {
    const home = await makeThrowawayHome();
    const adapter = createClaudeCodeAdapter({ cwd: REPO });
    const facts = await adapter.readBack(home, "no-such-session-id");
    expect(facts).toEqual({ sessionId: "no-such-session-id", itemCount: 0, openable: false });
  });

  it("reports a home that does not exist", async () => {
    const adapter = createClaudeCodeAdapter({ cwd: REPO });
    const facts = await adapter.readBack("/tmp/resume-from-cc-absent-home", "some-id");
    expect(facts.openable).toBe(false);
    expect(facts.itemCount).toBe(0);
  });
});

describe("T-CC-8 — the switch is refused with a named capability", () => {
  it("names create-only and hands over the resume command (FR-43, FR-45, C-2)", async () => {
    const adapter = createClaudeCodeAdapter({ cwd: REPO });
    expect(adapter.capabilities().landing).toBe("create-only");
    await expect(adapter.switchTo("/tmp/home", "abc-123", null)).rejects.toThrow(
      /create-only[\s\S]*claude --resume abc-123/,
    );
  });
});
