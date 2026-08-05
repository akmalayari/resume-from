/**
 * Live tests. They need an installed codex-cli and build their own throwaway home;
 * they never read or write a real Codex home. Gated per docs/tech-stack.md:
 *
 *   RESUME_FROM_LIVE=1 pnpm vitest run src/adapters/codex
 *
 * They exist because C-6 says Codex fails silently: nothing here may be inferred
 * from the absence of an error.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CanonicalSession, ProvenanceMarker, SerializedSession } from "./contract.js";
import { codexAdapterFactory } from "./index.js";
import { appServer, makeTempHome } from "./test-support.js";

const live = process.env.RESUME_FROM_LIVE === "1";
const adapter = codexAdapterFactory.create();

const FIRST_MESSAGE = "make the auth token refresh work";
const AGENT_ANSWER = "I'll look at how the token is stored first.";

const SESSION: CanonicalSession = {
  provenance: {
    ref: { agent: "codex", home: "/home/testuser/.codex", id: "01JQ8Z3K7M4N5P6Q7R8S9T0V1W" },
    title: FIRST_MESSAGE,
    startedAt: "2026-08-01T09:14:02Z",
    updatedAt: "2026-08-01T09:14:05Z",
    repo: { commit: "3f2a1bc9d4e5f60718293a4b5c6d7e8f90a1b2c3", branch: "main", changedPaths: [] },
  },
  turns: [
    {
      index: 0,
      role: "user",
      kind: "message",
      text: FIRST_MESSAGE,
      toolCall: null,
      timestamp: "2026-08-01T09:14:02Z",
    },
    {
      index: 1,
      role: "agent",
      kind: "message",
      text: AGENT_ANSWER,
      toolCall: null,
      timestamp: "2026-08-01T09:14:05Z",
    },
  ],
};

const MARKER: ProvenanceMarker = {
  sourceAgent: "codex",
  sourceHome: "/home/testuser/.codex",
  sourceSessionId: "01JQ8Z3K7M4N5P6Q7R8S9T0V1W",
  importedAt: new Date().toISOString(),
  droppedSummary: "dropped every result body and every reasoning trace",
  lines: ["Imported from codex — /home/testuser/.codex"],
};

interface Thread {
  id: string;
  preview: string;
  path: string | null;
  turns: { items: { type: string; text?: string; content?: { text: string }[] }[] }[];
}

function itemTexts(thread: Thread): { type: string; text: string }[] {
  return thread.turns.flatMap((turn) =>
    turn.items.map((item) => ({
      type: item.type,
      text: item.text ?? item.content?.map((part) => part.text).join("") ?? "",
    })),
  );
}

describe.skipIf(!live)("live: Codex", () => {
  let home = "";
  let serialized: SerializedSession;
  let previousCodexHome: string | undefined;

  beforeAll(() => {
    previousCodexHome = process.env.CODEX_HOME;
    home = makeTempHome("codex-live-home-");
    process.env.CODEX_HOME = home;
    serialized = adapter.serialize(
      SESSION,
      { agent: "codex", home, windowTokens: 258_400 },
      MARKER,
    );
    expect(adapter.validate(serialized)).toEqual([]);
    // The landing commits in production (FR-49, FR-53). Here, the test does it.
    for (const file of serialized.files) {
      mkdirSync(dirname(file.absolutePath), { recursive: true });
      writeFileSync(file.absolutePath, file.bytes);
    }
  });

  afterAll(() => {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    if (home !== "") rmSync(home, { recursive: true, force: true });
  });

  /** T-COD-15 — the default home is what Codex uses. */
  it("declares the home Codex itself resolves", async () => {
    // The throwaway home is pointed at with CODEX_HOME, the same variable Codex reads,
    // so the declared default and Codex's own answer must agree.
    expect(adapter.capabilities().defaultHome).toBe(home);
    const answers = await appServer(home, []);
    expect(answers.get(0)?.codexHome).toBe(home);

    const list = await appServer(home, [{ id: 1, method: "thread/list", params: {} }]);
    const threads = (list.get(1)?.data ?? []) as Thread[];
    expect(threads[0]?.path?.startsWith(`${home}/sessions/`)).toBe(true);
  });

  /** T-COD-16 — the C-8 scenario. */
  it("is listed with the imported preview and resumes with native turns", async () => {
    const answers = await appServer(home, [
      { id: 1, method: "thread/list", params: {} },
      { id: 2, method: "thread/resume", params: { threadId: serialized.sessionId } },
    ]);

    const threads = (answers.get(1)?.data ?? []) as Thread[];
    const listed = threads.find((thread) => thread.id === serialized.sessionId);
    expect(
      listed,
      "the imported thread must appear in the default thread/list filter",
    ).toBeDefined();
    expect(listed?.preview).toBe(FIRST_MESSAGE);

    const resumed = answers.get(2)?.thread as Thread | undefined;
    expect(resumed).toBeDefined();
    if (resumed === undefined) return;
    const items = itemTexts(resumed);
    expect(items.filter((item) => item.type === "userMessage").map((item) => item.text)).toContain(
      FIRST_MESSAGE,
    );
    expect(items.filter((item) => item.type === "agentMessage").map((item) => item.text)).toContain(
      AGENT_ANSWER,
    );
    expect(resumed.turns.length).toBeGreaterThan(0);
  });

  /** T-COD-17 — the C-7 failure is not reproduced. */
  it("shows none of C-7's symptoms", async () => {
    const answers = await appServer(home, [
      { id: 1, method: "thread/list", params: {} },
      {
        id: 2,
        method: "thread/read",
        params: { threadId: serialized.sessionId, includeTurns: true },
      },
    ]);

    const threads = (answers.get(1)?.data ?? []) as Thread[];
    const listed = threads.find((thread) => thread.id === serialized.sessionId);
    expect(listed, "C-7 symptom: the thread is missing from thread/list").toBeDefined();
    expect(listed?.preview ?? "", "C-7 symptom: the preview is empty").not.toBe("");

    const read = answers.get(2)?.thread as Thread | undefined;
    expect(read?.turns.length ?? 0, "C-7 symptom: thread/read reports zero turns").toBeGreaterThan(
      0,
    );
  });

  /** FR-52: the read-back this module performs agrees with the one Codex performs. */
  it("agrees with Codex on how many items were stored", async () => {
    const facts = await adapter.readBack(home, serialized.sessionId);
    expect(facts.itemCount).toBe(serialized.itemCount);
    expect(facts.openable).toBe(true);

    const answers = await appServer(home, [
      {
        id: 1,
        method: "thread/read",
        params: { threadId: serialized.sessionId, includeTurns: true },
      },
    ]);
    const read = answers.get(1)?.thread as Thread | undefined;
    expect(itemTexts(read ?? { id: "", preview: "", path: null, turns: [] })).toHaveLength(
      serialized.itemCount,
    );
  });
});
