import { rmSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createPiAdapter } from "./adapter.js";
import {
  makeThrowawayHome,
  piAssistantTextDraft,
  piCompactionDraft,
  piCustomMessageDraft,
  piModelChangeDraft,
  piSessionText,
  piToolCallDraft,
  piToolResultDraft,
  piUnknownDraft,
  piUserDraft,
  writeFixtureSession,
} from "./fixtures.js";
import { UNREADABLE_TITLE_PREFIX } from "./format.js";
import { changedPathsFromEntries, entriesToTurns, titleFromEntries } from "./parse.js";

const homes: string[] = [];

function throwawayHome(): string {
  const created = makeThrowawayHome();
  homes.push(created);
  return created;
}

afterEach(() => {
  while (homes.length > 0) {
    const dir = homes.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const CWD = "/Users/testuser/Workspace/demo";

const REFERENCE_DRAFTS = [
  piUserDraft("make the auth token refresh work"),
  piAssistantTextDraft("I'll look at how the token is stored first.", "hidden reasoning stays out"),
  piCompactionDraft("So far: the refresh call never wrote the new token back."),
  piToolCallDraft("call-1", "read", { path: "src/auth.ts" }),
  piToolResultDraft("call-1", "read", "line one\nline two\nline three"),
  piToolCallDraft("call-2", "write", { path: "src/auth.ts", content: "…" }),
  piToolResultDraft("call-2", "write", "wrote 42 lines"),
];

describe("T-PI-2 — a session file becomes canonical turns", () => {
  it("maps a header and message entries to five turns in source order", async () => {
    const adapter = createPiAdapter();
    const home = throwawayHome();
    writeFixtureSession(home, CWD, REFERENCE_DRAFTS);

    const [descriptor] = await adapter.listSessions(home);
    if (!descriptor) throw new Error("no descriptor listed");
    const session = await adapter.loadSession(descriptor);

    expect(session.turns.map((turn) => turn.index)).toEqual([0, 1, 2, 3, 4]);
    expect(session.turns.map((turn) => [turn.role, turn.kind])).toEqual([
      ["agent", "summary"],
      ["user", "message"],
      ["agent", "message"],
      ["agent", "tool-call"],
      ["agent", "tool-call"],
    ]);
    expect(session.turns[3]?.toolCall?.toolName).toBe("read");
    expect(session.turns[3]?.toolCall?.effect).toBe("read-only");
    expect(session.turns[4]?.toolCall?.toolName).toBe("write");
    expect(session.turns[4]?.toolCall?.effect).toBe("mutating");
    expect(session.turns[0]?.text).toContain("refresh call never wrote");
    expect(session.turns[1]?.text).toBe("make the auth token refresh work");
    expect(session.turns[3]?.text).toBe("");
  });

  it("carries the source provenance", async () => {
    const adapter = createPiAdapter();
    const home = throwawayHome();
    const written = writeFixtureSession(home, CWD, REFERENCE_DRAFTS);

    const [descriptor] = await adapter.listSessions(home);
    if (!descriptor) throw new Error("no descriptor listed");
    const session = await adapter.loadSession(descriptor);

    expect(session.provenance.ref).toEqual({
      agent: "pi",
      home,
      id: written.sessionId,
    });
    expect(session.provenance.title).toBe("make the auth token refresh work");
    expect(descriptor.repoPath).toBe(CWD);
    expect(descriptor.filePath).toBe(written.filePath);
    expect(descriptor.turnCount).toBe(5);
    expect(new Date(descriptor.updatedAt).toISOString()).toBe(descriptor.updatedAt);
    // Pi records neither the commit nor the branch; the changed files come from the
    // mutating tool calls (FR-36).
    expect(session.provenance.repo).toEqual({
      commit: null,
      branch: null,
      changedPaths: ["src/auth.ts"],
    });
  });

  it("never reads hidden reasoning into the canonical model (FR-28)", async () => {
    const adapter = createPiAdapter();
    const home = throwawayHome();
    writeFixtureSession(home, CWD, REFERENCE_DRAFTS);

    const [descriptor] = await adapter.listSessions(home);
    if (!descriptor) throw new Error("no descriptor listed");
    const session = await adapter.loadSession(descriptor);

    expect(JSON.stringify(session)).not.toContain("hidden reasoning stays out");
  });

  it("sorts the listing newest first (FR-14)", async () => {
    const adapter = createPiAdapter();
    const home = throwawayHome();
    writeFixtureSession(home, CWD, [piUserDraft("older")], {
      id: "session-older",
      startedAt: "2026-07-01T10:00:00.000Z",
    });
    writeFixtureSession(home, CWD, [piUserDraft("newer")], {
      id: "session-newer",
      startedAt: "2026-07-02T10:00:00.000Z",
    });

    const listed = await adapter.listSessions(home);
    expect(listed.map((descriptor) => descriptor.ref.id)).toEqual([
      "session-newer",
      "session-older",
    ]);
  });
});

describe("T-PI-3 — tool results become one outcome line", () => {
  const body = Array.from({ length: 400 }, (_, i) => `source line ${i} :: secret-${i}`).join("\n");

  const built = piSessionText([
    piToolCallDraft("call-1", "read", { path: "src/auth.ts" }),
    piToolResultDraft("call-1", "read", body),
  ]);
  const loaded = entriesToTurns(built.entries);

  it("produces exactly one tool-call turn", () => {
    expect(loaded.turns).toHaveLength(1);
    expect(loaded.turns[0]?.kind).toBe("tool-call");
  });

  it("writes one outcome line and marks the drop (FR-23, FR-25)", () => {
    const record = loaded.turns[0]?.toolCall;
    expect(record).toBeTruthy();
    expect(record?.outcomeLine.includes("\n")).toBe(false);
    expect(record?.outcomeLine.trim().length).toBeGreaterThan(0);
    expect(record?.bodyDropped).toBe(true);
  });

  it("carries no line of the result body (FR-24)", () => {
    const serialized = JSON.stringify(loaded.turns);
    for (const line of body.split("\n")) {
      expect(serialized).not.toContain(line);
    }
  });

  it("redacts tool credentials without losing a normal token-related path", () => {
    const apiKey = "sk-12345678901234567890";
    const password = "database-password";
    const uriPassword = "uri-supersecret";
    const userPassword = "curl-supersecret";
    const built = piSessionText([
      piToolCallDraft("call-secret", "write", {
        path: "src/token-refresh.ts",
        api_key: apiKey,
        command:
          `DATABASE_PASSWORD=${password} curl -u alice:${userPassword} ` +
          `https://alice:${uriPassword}@example.com/api`,
      }),
    ]);
    const loaded = entriesToTurns(built.entries);
    const canonical = JSON.stringify(loaded.turns);

    expect(changedPathsFromEntries(built.entries)).toEqual(["src/token-refresh.ts"]);
    expect(canonical).not.toContain(apiKey);
    expect(canonical).not.toContain(password);
    expect(canonical).not.toContain(uriPassword);
    expect(canonical).not.toContain(userPassword);
    expect(canonical).toContain("[REDACTED]");
  });

  it("marks a non-text result as dropped", () => {
    const built = piSessionText([
      piToolCallDraft("call-image", "read", { path: "diagram.png" }),
      piToolResultDraft("call-image", "read", ""),
    ]);
    const result = built.entries[1]?.message as Record<string, unknown>;
    result.content = [{ type: "image", data: "base64-data", mimeType: "image/png" }];

    const record = entriesToTurns(built.entries).turns[0]?.toolCall;
    expect(record?.bodyDropped).toBe(true);
    expect(record?.outcomeLine).toContain("result recorded");
    expect(record?.outcomeLine).toContain("content dropped");
    expect(JSON.stringify(record)).not.toContain("base64-data");
  });

  it("redacts a credential typed as a user message turn (FR-28, security)", () => {
    // A credential pasted into chat must not cross to a different model vendor.
    const bearer = "sk-1234567890abcdef1234";
    const built = piSessionText([
      piUserDraft(`run: curl -H "Authorization: Bearer ${bearer}" https://api.example.com`),
      piAssistantTextDraft("On it."),
    ]);
    const loaded = entriesToTurns(built.entries);
    const canonical = JSON.stringify(loaded.turns);

    expect(canonical).not.toContain(bearer);
    expect(canonical).toContain("[REDACTED]");
    // Normal assistant reply is not disturbed.
    expect(loaded.turns[1]?.text).toBe("On it.");
  });

  it("redacts a credential that appears as the session title (FR-28, security)", () => {
    // Pi derives the title from the first user message via titleFromEntries.
    // A credential in that text would otherwise flow unredacted into SourceProvenance.title.
    const bearer = "sk-1234567890abcdef1234";
    const built = piSessionText([piUserDraft(`call with Authorization: Bearer ${bearer}`)]);
    const derived = titleFromEntries(built.entries);

    expect(derived).not.toContain(bearer);
    expect(derived).toContain("[REDACTED]");
  });
});

describe("Pi active branch and compaction projection", () => {
  it("keeps only the last leaf's parent chain", () => {
    const built = piSessionText([
      piUserDraft("shared request"),
      piAssistantTextDraft("abandoned answer"),
      piAssistantTextDraft("active answer"),
    ]);
    const root = built.entries[0];
    const active = built.entries[2];
    if (!root || !active) throw new Error("fixture is incomplete");
    active.parentId = root.id;

    const loaded = entriesToTurns(built.entries);
    expect(loaded.unreadable).toBeNull();
    expect(loaded.turns.map((turn) => turn.text)).toEqual(["shared request", "active answer"]);
    expect(JSON.stringify(loaded)).not.toContain("abandoned answer");
  });

  it("uses the latest compaction and its first kept entry", () => {
    const built = piSessionText([
      piUserDraft("old request"),
      piCompactionDraft("older summary"),
      piUserDraft("kept request"),
      piCompactionDraft("latest summary"),
      piAssistantTextDraft("new answer"),
    ]);
    const kept = built.entries[2];
    const latest = built.entries[3];
    if (!kept || !latest) throw new Error("fixture is incomplete");
    latest.firstKeptEntryId = kept.id;

    const loaded = entriesToTurns(built.entries);
    expect(loaded.turns.map((turn) => turn.text)).toEqual([
      "latest summary",
      "kept request",
      "new answer",
    ]);
    expect(JSON.stringify(loaded)).not.toContain("older summary");
    expect(JSON.stringify(loaded)).not.toContain("old request");
  });

  it("prefers a materialized retained tail", () => {
    const retained = piSessionText([
      piUserDraft("retained request"),
      piAssistantTextDraft("retained answer"),
    ]).entries.map((entry) => entry.message as never);
    const built = piSessionText([
      piUserDraft("summarized request"),
      piCompactionDraft("current summary", { retainedTail: retained }),
      piUserDraft("post-compaction request"),
    ]);

    const loaded = entriesToTurns(built.entries);
    expect(loaded.turns.map((turn) => turn.text)).toEqual([
      "current summary",
      "retained request",
      "retained answer",
      "post-compaction request",
    ]);
    expect(JSON.stringify(loaded)).not.toContain("summarized request");
  });

  it("reports a cycle instead of flattening it", () => {
    const built = piSessionText([piUserDraft("root"), piAssistantTextDraft("loop")]);
    const leaf = built.entries[1];
    if (!leaf) throw new Error("fixture is incomplete");
    leaf.parentId = leaf.id;

    const loaded = entriesToTurns(built.entries);
    expect(loaded.turns).toEqual([]);
    expect(loaded.unreadable).toMatch(/cycle/);
  });
});

describe("T-PI-13 — a truncated session file", () => {
  it("is listed as unreadable and refuses to load", async () => {
    const adapter = createPiAdapter();
    const home = throwawayHome();
    const written = writeFixtureSession(home, CWD, REFERENCE_DRAFTS);
    writeFileSync(written.filePath, written.text.slice(0, written.text.length - 40), "utf8");

    const [descriptor] = await adapter.listSessions(home);
    if (!descriptor) throw new Error("no descriptor listed");
    expect(descriptor.title.startsWith(UNREADABLE_TITLE_PREFIX)).toBe(true);
    expect(descriptor.turnCount).toBe(0);

    await expect(adapter.loadSession(descriptor)).rejects.toThrow(written.filePath);
  });

  it("returns no shortened session", async () => {
    const adapter = createPiAdapter();
    const home = throwawayHome();
    const written = writeFixtureSession(home, CWD, REFERENCE_DRAFTS);
    writeFileSync(written.filePath, written.text.slice(0, written.text.length - 40), "utf8");

    const [descriptor] = await adapter.listSessions(home);
    if (!descriptor) throw new Error("no descriptor listed");
    await expect(adapter.loadSession(descriptor)).rejects.toThrow();
  });

  it("lists a broken parent chain as unreadable", async () => {
    const adapter = createPiAdapter();
    const home = throwawayHome();
    const written = writeFixtureSession(home, CWD, [
      piUserDraft("root"),
      piAssistantTextDraft("orphan"),
    ]);
    const lines = written.text.trim().split("\n");
    const leaf = JSON.parse(lines[2] as string) as Record<string, unknown>;
    leaf.parentId = "missing-parent";
    lines[2] = JSON.stringify(leaf);
    writeFileSync(written.filePath, `${lines.join("\n")}\n`, "utf8");

    const [descriptor] = await adapter.listSessions(home);
    if (!descriptor) throw new Error("no descriptor listed");
    expect(descriptor.title.startsWith(UNREADABLE_TITLE_PREFIX)).toBe(true);
    expect(descriptor.turnCount).toBe(0);
    await expect(adapter.loadSession(descriptor)).rejects.toThrow(/cannot be read/);
  });
});

describe("T-PI-14 — an unknown entry type is skipped, and the skip is visible", () => {
  const built = piSessionText([
    piUserDraft("hello"),
    piModelChangeDraft(),
    piUnknownDraft("quantum_entanglement"),
    piAssistantTextDraft("hi"),
  ]);
  const loaded = entriesToTurns(built.entries);

  it("does not turn the unknown entry into a turn", () => {
    expect(loaded.turns.map((turn) => turn.text)).toEqual(["hello", "hi"]);
  });

  it("reports the skip so the preview can warn", () => {
    expect(loaded.skippedCount).toBe(1);
    expect(loaded.skippedEntryTypes).toEqual(["quantum_entanglement"]);
  });

  it("does not report Pi's own bookkeeping entries as skipped", () => {
    const known = entriesToTurns(piSessionText([piUserDraft("hi"), piModelChangeDraft()]).entries);
    expect(known.skippedCount).toBe(0);
  });

  it("reports an extension's context message as skipped, not as a silent loss", () => {
    const extension = entriesToTurns(
      piSessionText([piUserDraft("hi"), piCustomMessageDraft("context-prune-summary")]).entries,
    );
    expect(extension.turns).toHaveLength(1);
    expect(extension.skippedEntryTypes).toEqual(["custom_message"]);
  });
});
