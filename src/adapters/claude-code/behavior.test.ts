import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClaudeCodeAdapter } from "./adapter.js";
import type { ProvenanceMarker, TargetProfile } from "./contract.js";
import { DROPPED_MARKER } from "./reader.js";
import {
  assistantTextEntry,
  assistantToolUseEntry,
  checksumTree,
  cleanupThrowaways,
  commitPendingFiles,
  type EntryContext,
  makeThrowawayHome,
  makeThrowawayRoot,
  toolResultEntry,
  userEntry,
  uuidFor,
  writeFileIn,
  writeSessionFile,
} from "./test-support.js";

const REPO = "/work/app";
const CTX: EntryContext = { cwd: REPO, gitBranch: "main", sessionId: "source-1" };

const MARKER: ProvenanceMarker = {
  sourceAgent: "claude-code",
  sourceHome: "/home/testuser/.claude",
  sourceSessionId: "source-1",
  importedAt: "2026-08-02T10:00:00.000Z",
  droppedSummary: "1 tool result body dropped",
  lines: ["Imported from claude-code (.claude)", "1 tool result body dropped"],
};

afterEach(async () => {
  await cleanupThrowaways();
});

describe("T-CC-19 — a work profile import", () => {
  it("opens under the work profile and leaves the personal profile untouched (FR-4, AC-6)", async () => {
    const root = await makeThrowawayRoot();
    const personal = path.join(root, ".claude");
    const work = path.join(root, ".claude-team");
    await writeFileIn(path.join(personal, "settings.json"), "{}");
    await writeFileIn(path.join(work, "settings.json"), "{}");
    await writeSessionFile(personal, REPO, "source-1", [
      userEntry(CTX, uuidFor(1), "2026-08-01T09:14:02.000Z", "make the auth token refresh work"),
      assistantTextEntry(CTX, uuidFor(2), "2026-08-01T09:14:05.000Z", "On it."),
    ]);

    const personalBefore = await checksumTree(personal);
    const adapter = createClaudeCodeAdapter({ cwd: REPO });
    const target: TargetProfile = { agent: "claude-code", home: work, windowTokens: 200_000 };

    const listed = await adapter.listSessions(personal);
    const session = await adapter.loadSession(listed[0] as never);
    const serialized = adapter.serialize(session, target, MARKER);
    expect(adapter.validate(serialized)).toEqual([]);
    await commitPendingFiles(serialized.files);

    const facts = await adapter.readBack(work, serialized.sessionId);
    expect(facts.openable).toBe(true);
    expect(serialized.files[0]?.absolutePath.startsWith(`${work}${path.sep}`)).toBe(true);

    expect(await checksumTree(personal)).toEqual(personalBefore);
    expect(await adapter.readBack(personal, serialized.sessionId)).toEqual({
      sessionId: serialized.sessionId,
      itemCount: 0,
      openable: false,
    });
  });
});

describe("T-CC-20 — a file changed after the source session", () => {
  it("carries the staleness marker and no content, so the target must read the file again (AC-3)", async () => {
    const root = await makeThrowawayRoot();
    const workfile = path.join(root, "auth.ts");
    const oldContent = Array.from({ length: 40 }, (_, i) => `OLD-CONTENT line ${i + 1}`).join("\n");
    await writeFile(workfile, oldContent, "utf8");

    const home = await makeThrowawayHome();
    await writeSessionFile(home, REPO, "source-1", [
      userEntry(CTX, uuidFor(1), "2026-08-01T09:14:02.000Z", "fix the refresh"),
      assistantToolUseEntry(CTX, uuidFor(2), "2026-08-01T09:14:06.000Z", "t1", "Read", {
        file_path: "src/auth.ts",
      }),
      toolResultEntry(
        CTX,
        uuidFor(3),
        "2026-08-01T09:14:07.000Z",
        "t1",
        await readFile(workfile, "utf8"),
      ),
    ]);

    // The file changes after the session was recorded.
    await writeFile(workfile, "NEW-CONTENT after the session", "utf8");

    const adapter = createClaudeCodeAdapter({ cwd: REPO });
    const targetHome = await makeThrowawayHome(".claude-target");
    const listed = await adapter.listSessions(home);
    const session = await adapter.loadSession(listed[0] as never);
    const call = session.turns.find((turn) => turn.kind === "tool-call")?.toolCall;

    expect(call?.outcomeLine).toBe(`Read('src/auth.ts') → 40 lines ${DROPPED_MARKER}`);
    expect(call?.bodyDropped).toBe(true);

    const serialized = adapter.serialize(
      session,
      { agent: "claude-code", home: targetHome, windowTokens: 200_000 },
      MARKER,
    );
    await commitPendingFiles(serialized.files);
    const committed = await readFile(serialized.files[0]?.absolutePath as string, "utf8");

    expect(committed).toContain(DROPPED_MARKER);
    expect(committed).not.toContain("OLD-CONTENT");
    expect(committed).not.toContain("NEW-CONTENT");
  });
});
