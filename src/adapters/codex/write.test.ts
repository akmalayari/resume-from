import { describe, expect, it } from "vitest";
import { REFERENCE_SESSION } from "../../../test/fixtures/reference-session.js";
import type { CanonicalSession, ProvenanceMarker, TargetProfile } from "./contract.js";
import { codexAdapterFactory } from "./index.js";
import type { RolloutEntry } from "./rollout.js";
import {
  CODEX_ENTRY_EVENT_MSG,
  CODEX_ENTRY_RESPONSE_ITEM,
  CODEX_ENTRY_SESSION_META,
  CODEX_EVENT_AGENT_MESSAGE,
  CODEX_EVENT_USER_MESSAGE,
  parseRolloutText,
  stringifyRollout,
} from "./rollout.js";

const adapter = codexAdapterFactory.create();

const TARGET: TargetProfile = {
  agent: "codex",
  home: "/tmp/codex-target-home",
  windowTokens: 258_400,
};

const MARKER: ProvenanceMarker = {
  sourceAgent: "codex",
  sourceHome: "/home/testuser/.codex",
  sourceSessionId: "01JQ8Z3K7M4N5P6Q7R8S9T0V1W",
  importedAt: "2026-08-02T10:00:00Z",
  droppedSummary: "dropped 4 result bodies and every reasoning trace",
  lines: [
    "Imported from codex — /home/testuser/.codex",
    "dropped 4 result bodies and every reasoning trace",
  ],
};

function entriesOf(bytes: Buffer): RolloutEntry[] {
  const parsed = parseRolloutText(bytes.toString("utf8"));
  expect(parsed.truncated).toBe(false);
  return parsed.entries;
}

function serializeReference(): {
  entries: RolloutEntry[];
  itemCount: number;
  sessionId: string;
} {
  const serialized = adapter.serialize(REFERENCE_SESSION, TARGET, MARKER);
  expect(serialized.files).toHaveLength(1);
  const file = serialized.files[0];
  if (file === undefined) throw new Error("no file");
  return {
    entries: entriesOf(file.bytes),
    itemCount: serialized.itemCount,
    sessionId: serialized.sessionId,
  };
}

/** T-COD-1 — capabilities are as designed. */
describe("T-COD-1 capabilities", () => {
  const capabilities = adapter.capabilities();

  it("declares codex, both roles, and the C-1/C-2 levels", () => {
    expect(capabilities.agent).toBe("codex");
    expect([...capabilities.roles].sort()).toEqual(["source", "target"]);
    expect(capabilities.selection).toBe("numbered-list");
    expect(capabilities.landing).toBe("create-only");
    expect(capabilities.provenance).toBe("host-output-only");
  });

  it("declares an absolute default home and a positive window", () => {
    expect(capabilities.defaultHome.startsWith("/")).toBe(true);
    expect(capabilities.defaultWindowTokens).toBeGreaterThan(0);
  });

  it("stays absolute even when CODEX_HOME is relative (FR-2)", () => {
    const previous = process.env.CODEX_HOME;
    process.env.CODEX_HOME = "./codex-home";
    try {
      expect(adapter.capabilities().defaultHome.startsWith("/")).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previous;
    }
  });
});

/** T-COD-4 — serialization writes event_msg entries. */
describe("T-COD-4 event_msg entries", () => {
  it("writes one user_message or agent_message event per canonical turn", () => {
    const { entries, itemCount } = serializeReference();
    const messages = entries.filter(
      (entry) =>
        entry.type === CODEX_ENTRY_EVENT_MSG &&
        (entry.payload.type === CODEX_EVENT_USER_MESSAGE ||
          entry.payload.type === CODEX_EVENT_AGENT_MESSAGE),
    );
    expect(messages).toHaveLength(REFERENCE_SESSION.turns.length);
    expect(itemCount).toBe(messages.length);
  });

  it("gives every turn an entry whose role matches the turn", () => {
    const { entries } = serializeReference();
    const turnEntries = entries.filter((entry) => entry.type === CODEX_ENTRY_EVENT_MSG);
    for (const [index, turn] of REFERENCE_SESSION.turns.entries()) {
      const entry = turnEntries[index];
      if (entry === undefined) throw new Error(`no entry for turn ${index}`);
      const expected = turn.role === "user" ? CODEX_EVENT_USER_MESSAGE : CODEX_EVENT_AGENT_MESSAGE;
      expect(entry.payload.type).toBe(expected);
      const text = turn.kind === "tool-call" ? (turn.toolCall?.outcomeLine ?? "") : turn.text;
      expect(entry.payload.message).toBe(text);
    }
  });

  it("does not write provenance as a conversation event", () => {
    const { entries } = serializeReference();
    const messages = entries.filter((entry) => entry.type === CODEX_ENTRY_EVENT_MSG);
    for (const line of MARKER.lines) expect(JSON.stringify(messages)).not.toContain(line);
  });
});

/** T-COD-5 — serialization writes the metadata the picker needs. */
describe("T-COD-5 picker metadata", () => {
  it("writes session metadata first, carrying the new session id", () => {
    const { entries, sessionId } = serializeReference();
    const meta = entries[0];
    if (meta === undefined) throw new Error("empty rollout");
    expect(meta.type).toBe(CODEX_ENTRY_SESSION_META);
    expect(meta.payload.id).toBe(sessionId);
    expect(meta.payload.session_id).toBe(sessionId);
    expect(String(meta.payload.cwd).startsWith("/")).toBe(true);
    expect(meta.payload.originator).toBeTruthy();
    expect(meta.payload.cli_version).toBeTruthy();
    expect(Number.isNaN(Date.parse(String(meta.payload.timestamp)))).toBe(false);
  });

  it("takes the preview from the first imported message", () => {
    const { entries } = serializeReference();
    const firstUser = entries.find(
      (entry) =>
        entry.type === CODEX_ENTRY_EVENT_MSG && entry.payload.type === CODEX_EVENT_USER_MESSAGE,
    );
    if (firstUser === undefined)
      throw new Error("no user_message entry — the picker would hide it");
    const firstUserTurn = REFERENCE_SESSION.turns.find((turn) => turn.role === "user");
    expect(firstUser.payload.message).toBe(firstUserTurn?.text);
    expect(String(firstUser.payload.message).length).toBeGreaterThan(0);
  });

  it("writes the file under the target home's sessions directory", () => {
    const serialized = adapter.serialize(REFERENCE_SESSION, TARGET, MARKER);
    const file = serialized.files[0];
    if (file === undefined) throw new Error("no file");
    expect(file.absolutePath.startsWith(`${TARGET.home}/sessions/`)).toBe(true);
    expect(file.absolutePath).toContain(serialized.sessionId);
    expect(file.absolutePath.endsWith(".jsonl")).toBe(true);
  });

  it("takes cwd from the injected dep, not from process.cwd() (b)", () => {
    const fixed = codexAdapterFactory.create({ cwd: () => "/fixed/repo" });
    const serialized = fixed.serialize(REFERENCE_SESSION, TARGET, MARKER);
    const file = serialized.files[0];
    if (file === undefined) throw new Error("no file");
    const entries = entriesOf(file.bytes);
    const meta = entries[0];
    if (meta === undefined) throw new Error("no metadata");
    expect(meta.payload.cwd).toBe("/fixed/repo");
  });
});

/** T-COD-6 — no response_item entries are written. */
describe("T-COD-6 no response_item entries", () => {
  it("writes none, because C-8 worked without them", () => {
    const { entries } = serializeReference();
    expect(entries.filter((entry) => entry.type === CODEX_ENTRY_RESPONSE_ITEM)).toEqual([]);
  });

  it("carries no reasoning entry of any kind (C-4, NG-8)", () => {
    const { entries } = serializeReference();
    for (const entry of entries) {
      expect(entry.payload.type).not.toBe("reasoning");
      expect(entry.payload.type).not.toBe("agent_reasoning");
      expect(entry.payload).not.toHaveProperty("encrypted_content");
    }
    const serialized = adapter.serialize(REFERENCE_SESSION, TARGET, MARKER);
    expect(serialized.files[0]?.bytes.toString("utf8")).not.toContain("encrypted_content");
  });
});

/** T-COD-20 — serialize is deterministic given fixed deps (a) and falls back to provenance when
 *  importedAt is unparsable — never reads the clock. */
describe("T-COD-20 deterministic serialize", () => {
  const FIXED_ID = "00000000-0000-4000-8000-000000000001";
  const fixedDeps = { cwd: () => "/fixed/repo", newSessionId: () => FIXED_ID };

  it("produces byte-equal output on two calls with the same deps (a)", () => {
    const fixed = codexAdapterFactory.create(fixedDeps);
    const first = fixed.serialize(REFERENCE_SESSION, TARGET, MARKER);
    const second = fixed.serialize(REFERENCE_SESSION, TARGET, MARKER);
    expect(first.files[0]?.bytes).toEqual(second.files[0]?.bytes);
    expect(first.files[0]?.absolutePath).toBe(second.files[0]?.absolutePath);
    expect(first.sessionId).toBe(second.sessionId);
  });

  it("falls back to provenance.updatedAt when importedAt is not a valid date", () => {
    const badMarker: ProvenanceMarker = { ...MARKER, importedAt: "not-a-date" };
    const updatedAt = REFERENCE_SESSION.provenance.updatedAt;
    const fixed = codexAdapterFactory.create(fixedDeps);
    const serialized = fixed.serialize(REFERENCE_SESSION, TARGET, badMarker);
    const file = serialized.files[0];
    if (file === undefined) throw new Error("no file");
    const entries = entriesOf(file.bytes);
    const meta = entries[0];
    if (meta === undefined) throw new Error("no metadata");
    // The stamp must come from provenance.updatedAt, not from new Date()
    expect(meta.payload.timestamp).toBe(new Date(updatedAt).toISOString());
  });

  it("falls back to Unix epoch when importedAt, updatedAt, and startedAt are all unparsable", () => {
    const badMarker: ProvenanceMarker = { ...MARKER, importedAt: "bad" };
    const badSession: CanonicalSession = {
      ...REFERENCE_SESSION,
      provenance: {
        ...REFERENCE_SESSION.provenance,
        updatedAt: "bad",
        startedAt: "bad",
      },
    };
    const fixed = codexAdapterFactory.create(fixedDeps);
    const serialized = fixed.serialize(badSession, TARGET, badMarker);
    const file = serialized.files[0];
    if (file === undefined) throw new Error("no file");
    const entries = entriesOf(file.bytes);
    const meta = entries[0];
    if (meta === undefined) throw new Error("no metadata");
    expect(meta.payload.timestamp).toBe(new Date(0).toISOString());
  });
});

/** FR-50: validate is the gate before placement. */
describe("validate", () => {
  it("passes a freshly serialized session", () => {
    const serialized = adapter.serialize(REFERENCE_SESSION, TARGET, MARKER);
    expect(adapter.validate(serialized)).toEqual([]);
  });

  it("reports a rollout whose preview would be empty (C-7)", () => {
    const serialized = adapter.serialize(
      {
        ...REFERENCE_SESSION,
        turns: REFERENCE_SESSION.turns.filter((t) => t.role !== "user"),
      },
      TARGET,
      MARKER,
    );
    const defects = adapter.validate(serialized);
    expect(defects.length).toBeGreaterThan(0);
    expect(defects.map((defect) => defect.message).join(" ")).toMatch(/preview/i);
  });

  it("reports a mismatch between itemCount and the entries written (FR-52)", () => {
    const serialized = adapter.serialize(REFERENCE_SESSION, TARGET, MARKER);
    const defects = adapter.validate({
      ...serialized,
      itemCount: serialized.itemCount + 1,
    });
    expect(defects.map((defect) => defect.path)).toContain("itemCount");
  });

  it("reports a rollout with no session metadata", () => {
    const serialized = adapter.serialize(REFERENCE_SESSION, TARGET, MARKER);
    const file = serialized.files[0];
    if (file === undefined) throw new Error("no file");
    const withoutMeta = file.bytes
      .toString("utf8")
      .split("\n")
      .filter((line) => line !== "" && !line.includes(`"${CODEX_ENTRY_SESSION_META}"`))
      .map((line) => `${line}\n`)
      .join("");
    const defects = adapter.validate({
      ...serialized,
      files: [
        {
          absolutePath: file.absolutePath,
          bytes: Buffer.from(withoutMeta, "utf8"),
        },
      ],
    });
    expect(defects.map((defect) => defect.message).join(" ")).toMatch(/session metadata/i);
  });

  it("reports a mismatch in either metadata id field", () => {
    const serialized = adapter.serialize(REFERENCE_SESSION, TARGET, MARKER);
    const file = serialized.files[0];
    if (file === undefined) throw new Error("no file");
    const entries = entriesOf(file.bytes);
    const meta = entries[0];
    if (meta === undefined) throw new Error("no metadata");
    meta.payload.session_id = "00000000-0000-4000-8000-000000000000";

    const defects = adapter.validate({
      ...serialized,
      files: [{ ...file, bytes: Buffer.from(stringifyRollout(entries), "utf8") }],
    });
    expect(defects.map((defect) => defect.message).join(" ")).toMatch(/different session/i);
  });

  it("reports a rollout filename that names another session", () => {
    const serialized = adapter.serialize(REFERENCE_SESSION, TARGET, MARKER);
    const file = serialized.files[0];
    if (file === undefined) throw new Error("no file");
    const wrongId = "00000000-0000-4000-8000-000000000000";
    const defects = adapter.validate({
      ...serialized,
      files: [
        {
          ...file,
          absolutePath: file.absolutePath.replace(serialized.sessionId, wrongId),
        },
      ],
    });
    expect(defects.map((defect) => defect.message).join(" ")).toMatch(/filename.*different/i);
  });
});
