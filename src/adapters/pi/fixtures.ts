/**
 * Test support for this module only. Builders for Pi session files, throwaway homes
 * and directory checksums. Not part of the public contract and not imported by any
 * other module.
 */

import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { ProvenanceMarker } from "./contract.js";
import {
  emptyUsage,
  PI_SESSION_VERSION,
  type PiAssistantMessage,
  type PiCompactionEntry,
  type PiEntry,
  type PiMessage,
  type PiSessionHeader,
  type PiToolResultMessage,
  type PiUserMessage,
  sessionDirFor,
  sessionFileName,
} from "./format.js";

let entryCounter = 0;

function nextEntryId(): string {
  entryCounter += 1;
  return entryCounter.toString(16).padStart(8, "0");
}

const BASE_TIME = Date.parse("2026-08-01T09:14:02.000Z");
let clockStep = 0;

function nextIso(): string {
  clockStep += 1;
  return new Date(BASE_TIME + clockStep * 1000).toISOString();
}

type EntryDraft = Omit<PiEntry, "id" | "parentId" | "timestamp"> & {
  timestamp?: string;
};

export function piUserDraft(text: string): EntryDraft {
  const message: PiUserMessage = {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  };
  return { type: "message", message } as unknown as EntryDraft;
}

export function piAssistantTextDraft(text: string, thinking?: string): EntryDraft {
  const content: PiAssistantMessage["content"] = [];
  if (thinking !== undefined) {
    content.push({ type: "thinking", thinking, thinkingSignature: "sig" });
  }
  content.push({ type: "text", text, textSignature: "sig" });
  const message: PiAssistantMessage = {
    role: "assistant",
    content,
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-opus-5",
    usage: emptyUsage(),
    stopReason: "stop",
    timestamp: Date.now(),
  };
  return { type: "message", message } as unknown as EntryDraft;
}

export function piToolCallDraft(
  callId: string,
  name: string,
  args: Record<string, unknown>,
): EntryDraft {
  const message: PiAssistantMessage = {
    role: "assistant",
    content: [{ type: "toolCall", id: callId, name, arguments: args }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-opus-5",
    usage: emptyUsage(),
    stopReason: "toolUse",
    timestamp: Date.now(),
  };
  return { type: "message", message } as unknown as EntryDraft;
}

export function piToolResultDraft(
  callId: string,
  name: string,
  body: string,
  isError = false,
): EntryDraft {
  const message: PiToolResultMessage = {
    role: "toolResult",
    toolCallId: callId,
    toolName: name,
    content: [{ type: "text", text: body }],
    isError,
    timestamp: Date.now(),
  };
  return { type: "message", message } as unknown as EntryDraft;
}

export function piCompactionDraft(
  summary: string,
  options: { firstKeptEntryId?: string; retainedTail?: PiMessage[] } = {},
): EntryDraft {
  const draft: Omit<PiCompactionEntry, "id" | "parentId" | "timestamp"> = {
    type: "compaction",
    summary,
    firstKeptEntryId: options.firstKeptEntryId ?? "__first__",
    ...(options.retainedTail === undefined ? {} : { retainedTail: options.retainedTail }),
    tokensBefore: 1234,
  };
  return draft as unknown as EntryDraft;
}

export function piModelChangeDraft(): EntryDraft {
  return {
    type: "model_change",
    provider: "anthropic",
    modelId: "claude-opus-5",
  } as unknown as EntryDraft;
}

export function piCustomMessageDraft(customType: string): EntryDraft {
  return {
    type: "custom_message",
    customType,
    content: "an extension put conversation content here",
    display: true,
  } as unknown as EntryDraft;
}

export function piUnknownDraft(type: string): EntryDraft {
  return {
    type,
    payload: "something this adapter has never seen",
  } as unknown as EntryDraft;
}

/** Render a whole Pi session file: a `session` header followed by chained entries. */
export function piSessionText(
  drafts: EntryDraft[],
  options: { id?: string; cwd?: string; startedAt?: string } = {},
): { text: string; header: PiSessionHeader; entries: PiEntry[] } {
  const header: PiSessionHeader = {
    type: "session",
    version: PI_SESSION_VERSION,
    id: options.id ?? "019fd1d1-e499-7196-95ff-a1b2c3d4e5f6",
    timestamp: options.startedAt ?? new Date(BASE_TIME).toISOString(),
    cwd: options.cwd ?? "/Users/testuser/Workspace/demo",
  };
  let parentId: string | null = null;
  const entries: PiEntry[] = [];
  for (const draft of drafts) {
    const id = nextEntryId();
    const entry = {
      ...draft,
      ...(draft.type === "compaction" && draft.firstKeptEntryId === "__first__"
        ? { firstKeptEntryId: entries[0]?.id }
        : {}),
      id,
      parentId,
      timestamp: draft.timestamp ?? nextIso(),
    } as PiEntry;
    entries.push(entry);
    parentId = id;
  }
  const lines = [header, ...entries].map((entry) => JSON.stringify(entry));
  return { text: `${lines.join("\n")}\n`, header, entries };
}

/** Write a Pi session file into `home` exactly where Pi itself would keep it. */
export function writeFixtureSession(
  home: string,
  cwd: string,
  drafts: EntryDraft[],
  options: { id?: string; startedAt?: string } = {},
): { filePath: string; sessionId: string; text: string } {
  const id = options.id ?? `019fd1d1-e499-7196-95ff-${nextEntryId()}0000`;
  const startedAt = options.startedAt ?? new Date(BASE_TIME).toISOString();
  const built = piSessionText(drafts, { id, cwd, startedAt });
  const dir = sessionDirFor(home, cwd);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, sessionFileName(startedAt, id));
  writeFileSync(filePath, built.text, "utf8");
  return { filePath, sessionId: id, text: built.text };
}

/** A throwaway home. Never a real Pi home (docs/tech-stack.md, C-3). */
export function makeThrowawayHome(): string {
  const home = mkdtempSync(join(tmpdir(), "resume-from-pi-"));
  mkdirSync(join(home, "sessions"), { recursive: true });
  return home;
}

/** SHA-256 of every file below `dir`, keyed by relative path. */
export function checksumTree(dir: string): Map<string, string> {
  const sums = new Map<string, string>();
  const walk = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      sums.set(relative(dir, full), createHash("sha256").update(readFileSync(full)).digest("hex"));
    }
  };
  walk(dir);
  return sums;
}

export function markerFixture(): ProvenanceMarker {
  return {
    sourceAgent: "codex",
    sourceHome: "/home/testuser/.codex",
    sourceSessionId: "01JQ8Z3K7M4N5P6Q7R8S9T0V1W",
    importedAt: "2026-08-02T10:00:00.000Z",
    droppedSummary: "3 tool result bodies dropped",
    lines: ["Imported from codex — 01JQ8Z3K7M4N5P6Q7R8S9T0V1W", "3 tool result bodies dropped"],
  };
}

export function entriesOf(text: string): Record<string, unknown>[] {
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
