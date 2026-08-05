import { afterEach, describe, expect, it } from "vitest";
import { createClaudeCodeAdapter } from "./adapter.js";
import { DROPPED_MARKER, readSessionText, UNREADABLE_TITLE } from "./reader.js";
import {
  assistantTextEntry,
  assistantToolUseEntry,
  bodyOfLines,
  cleanupThrowaways,
  type EntryContext,
  makeThrowawayHome,
  referenceEntries,
  systemEntry,
  toolResultEntry,
  unknownTypeEntry,
  userEntry,
  uuidFor,
  writeSessionFile,
} from "./test-support.js";

const REPO = "/work/app";
const OTHER_REPO = "/work/other";
const CTX: EntryContext = { cwd: REPO, gitBranch: "fix/auth-refresh", sessionId: "s-1" };

afterEach(async () => {
  await cleanupThrowaways();
});

function textOf(entries: unknown[]): string {
  return entries.map((entry) => JSON.stringify(entry)).join("\n");
}

describe("T-CC-2 — a session file becomes canonical turns", () => {
  const read = readSessionText(
    textOf([
      ...referenceEntries(CTX, bodyOfLines(400, "BODY")),
      systemEntry(CTX, uuidFor(7), "2026-08-01T09:15:41.000Z", "local command output"),
      unknownTypeEntry("file-history-snapshot", { messageId: "m1" }),
    ]),
  );

  it("keeps the messages, the summary and the call, in source order", () => {
    expect(read.unreadable).toBeNull();
    expect(read.turns.map((turn) => [turn.role, turn.kind])).toEqual([
      ["user", "message"],
      ["agent", "message"],
      ["agent", "tool-call"],
      ["agent", "message"],
      ["agent", "summary"],
    ]);
    expect(read.turns.map((turn) => turn.index)).toEqual([0, 1, 2, 3, 4]);
    expect(read.turns[0]?.text).toBe("make the auth token refresh work");
    expect(read.turns[4]?.text).toContain("Fixed the write path");
    expect(read.turns[2]?.text).toBe("");
    expect(read.turns[2]?.toolCall?.toolName).toBe("Read");
  });

  it("carries the repository facts the descriptor and the snapshot need", () => {
    expect(read.repoPath).toBe(REPO);
    expect(read.branch).toBe("fix/auth-refresh");
    expect(read.title).toBe("make the auth token refresh work");
    expect(read.startedAt).toBe("2026-08-01T09:14:02.000Z");
    expect(read.updatedAt).toBe("2026-08-01T09:15:40.000Z");
  });

  it("counts the entries it does not read instead of guessing at them", () => {
    expect(read.skipped).toBeGreaterThan(0);
  });

  it("collects the paths the mutating calls changed (FR-36)", () => {
    const withEdit = readSessionText(
      textOf([
        assistantToolUseEntry(CTX, uuidFor(1), "2026-08-01T09:14:06.000Z", "t1", "Edit", {
          file_path: "src/auth.ts",
          old_string: "a",
          new_string: "b",
        }),
        toolResultEntry(CTX, uuidFor(2), "2026-08-01T09:14:07.000Z", "t1", "1 hunk applied"),
      ]),
    );
    expect(withEdit.changedPaths).toEqual(["src/auth.ts"]);
    expect(withEdit.turns[0]?.toolCall?.effect).toBe("mutating");
  });
});

describe("T-CC-3 — tool results become one outcome line", () => {
  const marker = "SECRET-BODY-CONTENT";
  const read = readSessionText(textOf(referenceEntries(CTX, bodyOfLines(400, marker))));
  const call = read.turns.find((turn) => turn.kind === "tool-call")?.toolCall;

  it("summarises the 400-line result in one line (FR-23)", () => {
    expect(call?.outcomeLine.startsWith("Read('src/auth.ts') → 400 lines")).toBe(true);
    expect(call?.outcomeLine.split("\n")).toHaveLength(1);
    expect(call?.argumentsText).toBe("'src/auth.ts'");
  });

  it("marks the dropped body so the model can read it (FR-25)", () => {
    expect(call?.bodyDropped).toBe(true);
    expect(call?.outcomeLine).toContain(DROPPED_MARKER);
  });

  it("keeps no line of the body (FR-24)", () => {
    expect(JSON.stringify(read.turns)).not.toContain(marker);
  });

  it("keeps hidden reasoning out too", () => {
    expect(JSON.stringify(read.turns)).not.toContain("the user wants the refresh path checked");
  });

  it("marks a structured result as dropped even though its size is unknown (FR-25)", () => {
    const structured = readSessionText(
      textOf([
        assistantToolUseEntry(CTX, uuidFor(1), "2026-08-01T09:14:06.000Z", "t1", "Glob", {
          pattern: "**/*.ts",
        }),
        {
          type: "user",
          uuid: uuidFor(2),
          timestamp: "2026-08-01T09:14:07.000Z",
          cwd: REPO,
          message: {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "t1", content: { files: ["a.ts", "b.ts"] } },
            ],
          },
        },
      ]),
    );
    const call = structured.turns[0]?.toolCall;
    expect(call?.bodyDropped).toBe(true);
    expect(call?.outcomeLine).toContain(DROPPED_MARKER);
    expect(JSON.stringify(structured.turns)).not.toContain("a.ts");
  });

  it("says so plainly when a call has no result at all", () => {
    const pending = readSessionText(
      textOf([
        assistantToolUseEntry(CTX, uuidFor(1), "2026-08-01T09:14:06.000Z", "t9", "Read", {
          file_path: "src/auth.ts",
        }),
      ]),
    );
    const call = pending.turns[0]?.toolCall;
    expect(call?.outcomeLine).toBe("Read('src/auth.ts') → no result recorded");
    expect(call?.bodyDropped).toBe(false);
  });
});

describe("T-CC-14 — excluded content never crosses", () => {
  const secrets = [
    "You are Claude Code, a system prompt",
    "DEVELOPER-PROMPT-TEXT",
    "OPENAI_API_KEY=sk-secret-token",
    "TELEMETRY-EVENT-PAYLOAD",
  ];
  const read = readSessionText(
    textOf([
      systemEntry(CTX, uuidFor(1), "2026-08-01T09:14:00.000Z", secrets[0] as string),
      unknownTypeEntry("developer", { content: secrets[1] }),
      userEntry(CTX, uuidFor(2), "2026-08-01T09:14:01.000Z", `<env>${secrets[2]}</env>`, {
        isMeta: true,
      }),
      unknownTypeEntry("telemetry", { payload: secrets[3] }),
      userEntry(CTX, uuidFor(3), "2026-08-01T09:14:02.000Z", "make the auth token refresh work"),
      assistantTextEntry(CTX, uuidFor(4), "2026-08-01T09:14:05.000Z", "On it."),
    ]),
  );

  it("loads only the two real messages", () => {
    expect(read.turns).toHaveLength(2);
    expect(read.turns[0]?.text).toBe("make the auth token refresh work");
  });

  it.each(secrets)("never carries %s into the canonical session (FR-28, NG-7)", (secret) => {
    expect(JSON.stringify(read)).not.toContain(secret);
  });
});

describe("T-CC-15 — a truncated or unknown-typed session", () => {
  it("reports a session cut mid-entry as unreadable", async () => {
    const home = await makeThrowawayHome();
    await writeSessionFile(home, REPO, "cut-1", referenceEntries(CTX, "short body"), {
      truncate: true,
    });
    const adapter = createClaudeCodeAdapter({ cwd: REPO });

    const listed = await adapter.listSessions(home);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.title).toBe(UNREADABLE_TITLE);
    expect(listed[0]?.turnCount).toBe(0);

    await expect(adapter.loadSession(listed[0] as never)).rejects.toThrow(/cut-1\.jsonl/);
  });

  it("loads what it understands from unknown entry types and reports the skipped ones", () => {
    const read = readSessionText(
      textOf([
        unknownTypeEntry("mode", { mode: "normal" }),
        userEntry(CTX, uuidFor(1), "2026-08-01T09:14:02.000Z", "hello"),
        unknownTypeEntry("bridge-session", { id: "x" }),
        unknownTypeEntry("queue-operation", { op: "push" }),
        assistantTextEntry(CTX, uuidFor(2), "2026-08-01T09:14:05.000Z", "hi"),
      ]),
    );
    expect(read.unreadable).toBeNull();
    expect(read.turns).toHaveLength(2);
    expect(read.skipped).toBe(3);
  });
});

describe("listing a home (FR-2, FR-4, FR-11, FR-13, FR-14)", () => {
  it("lists every project directory of the home, newest first, with every field set", async () => {
    const home = await makeThrowawayHome();
    await writeSessionFile(home, REPO, "s-old", [
      userEntry(CTX, uuidFor(1), "2026-07-01T10:00:00.000Z", "older work"),
      assistantTextEntry(CTX, uuidFor(2), "2026-07-01T10:00:05.000Z", "done"),
    ]);
    await writeSessionFile(home, REPO, "s-new", referenceEntries(CTX, "body"));
    await writeSessionFile(home, OTHER_REPO, "s-other", [
      userEntry({ ...CTX, cwd: OTHER_REPO }, uuidFor(3), "2026-07-15T10:00:00.000Z", "other repo"),
    ]);

    const adapter = createClaudeCodeAdapter({ cwd: REPO });
    const listed = await adapter.listSessions(home);

    expect(listed.map((d) => d.ref.id)).toEqual(["s-new", "s-other", "s-old"]);
    const newest = listed[0];
    expect(newest?.ref.agent).toBe("claude-code");
    expect(newest?.ref.home).toBe(home);
    expect(newest?.title).toBe("make the auth token refresh work");
    expect(newest?.repoPath).toBe(REPO);
    expect(newest?.turnCount).toBe(5);
    expect(newest?.filePath.endsWith("s-new.jsonl")).toBe(true);
    expect(listed.find((d) => d.ref.id === "s-other")?.repoPath).toBe(OTHER_REPO);
  });

  it("loads a listed session into the neutral vocabulary", async () => {
    const home = await makeThrowawayHome();
    await writeSessionFile(home, REPO, "s-1", referenceEntries(CTX, bodyOfLines(400, "BODY")));
    const adapter = createClaudeCodeAdapter({ cwd: REPO });
    const [descriptor] = await adapter.listSessions(home);
    const session = await adapter.loadSession(descriptor as never);

    expect(session.provenance.ref.id).toBe("s-1");
    expect(session.provenance.repo.branch).toBe("fix/auth-refresh");
    expect(session.provenance.repo.commit).toBeNull();
    expect(session.turns).toHaveLength(descriptor?.turnCount as number);
  });

  it("returns nothing for a home with no projects directory", async () => {
    const home = await makeThrowawayHome("empty-home");
    const adapter = createClaudeCodeAdapter({ cwd: REPO });
    expect(await adapter.listSessions(home)).toEqual([]);
  });
});

describe("reading never opens a source file for writing (NG-1, AC-4)", () => {
  it("keeps a foreign tool name unchanged (FR-27)", () => {
    const read = readSessionText(
      textOf([
        assistantToolUseEntry(CTX, uuidFor(1), "2026-08-01T09:14:06.000Z", "t1", "Frobnicate", {
          target: "x",
        }),
        toolResultEntry(CTX, uuidFor(2), "2026-08-01T09:14:07.000Z", "t1", "done"),
      ]),
    );
    expect(read.turns[0]?.toolCall?.toolName).toBe("Frobnicate");
    expect(read.turns[0]?.toolCall?.effect).toBe("unknown");
  });
});
