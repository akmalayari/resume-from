/**
 * Reading a Pi session file into the canonical vocabulary.
 *
 * Two rules decide everything here:
 * - no result body crosses (FR-24). A tool result becomes one outcome line (FR-23, FR-25);
 * - nothing is guessed. An entry type this adapter does not know is skipped and counted,
 *   and an unparsable line makes the whole file unreadable rather than shorter.
 */

import type { CanonicalTurn, ToolCallRecord } from "./contract.js";
import {
  asEntry,
  asHeader,
  DROPPED_BODY_NOTE,
  entryMessage,
  isRecord,
  NON_TURN_ENTRY_TYPES,
  oneLine,
  type PiEntry,
  type PiSessionHeader,
  shortArguments,
  toIsoUtc,
  toolCallBlocks,
  toolEffectFor,
  visibleText,
} from "./format.js";

export interface ParsedSessionFile {
  header: PiSessionHeader | null;
  entries: PiEntry[];
  /** True when a line was not JSON: the file was cut, or written by something else. */
  truncated: boolean;
}

export interface LoadedTurns {
  turns: CanonicalTurn[];
  /** Entry types this adapter does not know. Visible so the preview can warn (T-PI-14). */
  skippedEntryTypes: string[];
  skippedCount: number;
}

export function parseSessionText(text: string): ParsedSessionFile {
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  const entries: PiEntry[] = [];
  let header: PiSessionHeader | null = null;
  let truncated = false;

  for (const [index, line] of lines.entries()) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      truncated = true;
      continue;
    }
    if (index === 0) {
      header = asHeader(value);
      if (header) continue;
    }
    const entry = asEntry(value);
    if (entry) entries.push(entry);
    else truncated = true;
  }

  return { header, entries, truncated };
}

/** The result bodies of a session, keyed by tool call id. Read once, never carried. */
function indexToolResults(entries: PiEntry[]): Map<string, { body: string; isError: boolean }> {
  const results = new Map<string, { body: string; isError: boolean }>();
  for (const entry of entries) {
    const message = entryMessage(entry);
    if (message?.role !== "toolResult") continue;
    const callId = typeof message.toolCallId === "string" ? message.toolCallId : "";
    if (callId.length === 0) continue;
    results.set(callId, {
      body: visibleText(message.content),
      isError: message.isError === true,
    });
  }
  return results;
}

function outcomeOf(result: { body: string; isError: boolean } | undefined): {
  outcome: string;
  bodyDropped: boolean;
} {
  if (!result) return { outcome: "no result recorded", bodyDropped: false };
  if (result.body.trim().length === 0) {
    return { outcome: result.isError ? "error" : "no output", bodyDropped: false };
  }
  const lineCount = result.body.split("\n").length;
  const what = result.isError ? "error" : `${lineCount} ${lineCount === 1 ? "line" : "lines"}`;
  return { outcome: `${what} ${DROPPED_BODY_NOTE}`, bodyDropped: true };
}

function toolCallRecord(
  name: string,
  args: Record<string, unknown>,
  result: { body: string; isError: boolean } | undefined,
): ToolCallRecord {
  const argumentsText = JSON.stringify(args);
  const { outcome, bodyDropped } = outcomeOf(result);
  return {
    toolName: name,
    argumentsText,
    outcomeLine: oneLine(`${name}(${shortArguments(argumentsText)}) → ${outcome}`),
    effect: toolEffectFor(name),
    bodyDropped,
  };
}

export function entriesToTurns(entries: PiEntry[]): LoadedTurns {
  const results = indexToolResults(entries);
  const turns: CanonicalTurn[] = [];
  const skippedEntryTypes: string[] = [];
  let skippedCount = 0;

  const push = (turn: Omit<CanonicalTurn, "index">): void => {
    turns.push({ ...turn, index: turns.length });
  };

  const skip = (type: string): void => {
    skippedCount += 1;
    if (!skippedEntryTypes.includes(type)) skippedEntryTypes.push(type);
  };

  for (const entry of entries) {
    const timestamp = toIsoUtc(entry.timestamp);

    if (entry.type === "compaction" || entry.type === "branch_summary") {
      const summary = typeof entry.summary === "string" ? entry.summary : "";
      if (summary.trim().length > 0) {
        push({ role: "agent", kind: "summary", text: summary, toolCall: null, timestamp });
      }
      continue;
    }

    if (entry.type === "message") {
      const message = entryMessage(entry);
      if (!message) {
        skip("message/malformed");
        continue;
      }
      if (message.role === "toolResult") continue;

      if (message.role === "user") {
        const text = visibleText(message.content);
        if (text.trim().length > 0) {
          push({ role: "user", kind: "message", text, toolCall: null, timestamp });
        }
        continue;
      }

      if (message.role === "assistant") {
        const content = Array.isArray(message.content) ? message.content : [];
        let buffered = "";
        const flush = (): void => {
          if (buffered.trim().length === 0) {
            buffered = "";
            return;
          }
          push({ role: "agent", kind: "message", text: buffered, toolCall: null, timestamp });
          buffered = "";
        };
        if (!Array.isArray(message.content)) {
          buffered = visibleText(message.content);
        }
        for (const block of content) {
          if (!isRecord(block)) continue;
          if (block.type === "text" && typeof block.text === "string") {
            buffered = buffered.length > 0 ? `${buffered}\n${block.text}` : block.text;
            continue;
          }
          // "thinking" blocks are hidden reasoning and never cross (FR-28, NG-7).
          if (block.type !== "toolCall") continue;
          flush();
          const [call] = toolCallBlocks([block]);
          if (!call) continue;
          push({
            role: "agent",
            kind: "tool-call",
            text: "",
            toolCall: toolCallRecord(call.name, call.arguments, results.get(call.id)),
            timestamp,
          });
        }
        flush();
        continue;
      }

      skip(`message/${String(message.role)}`);
      continue;
    }

    if (NON_TURN_ENTRY_TYPES.has(entry.type)) continue;

    skip(entry.type);
  }

  return { turns, skippedEntryTypes, skippedCount };
}

/** Short human title: the session's own name, else its first user message. */
export function titleFromEntries(entries: PiEntry[]): string | null {
  for (const entry of entries) {
    if (entry.type !== "session_info") continue;
    if (typeof entry.name === "string" && entry.name.trim().length > 0) return entry.name;
  }
  for (const entry of entries) {
    const message = entryMessage(entry);
    if (message?.role !== "user") continue;
    const text = visibleText(message.content);
    if (text.trim().length > 0) return text;
  }
  return null;
}

/** Keys Pi's mutating tools name their target with. */
const PATH_ARGUMENT_KEYS = ["path", "file_path", "filePath", "file", "target"];

/** Files the mutating tool calls of a session touched (FR-36). */
export function changedPathsFrom(turns: CanonicalTurn[]): string[] {
  const paths = new Set<string>();
  for (const turn of turns) {
    if (turn.toolCall?.effect !== "mutating") continue;
    let args: unknown;
    try {
      args = JSON.parse(turn.toolCall.argumentsText);
    } catch {
      continue;
    }
    if (!isRecord(args)) continue;
    for (const key of PATH_ARGUMENT_KEYS) {
      const value = args[key];
      if (typeof value === "string" && value.trim().length > 0) {
        paths.add(value);
        break;
      }
    }
  }
  return [...paths];
}

/** The last timestamp the file recorded, ISO-8601 UTC, or null. */
export function lastTimestamp(entries: PiEntry[]): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry) continue;
    const iso = toIsoUtc(entry.timestamp);
    if (iso) return iso;
  }
  return null;
}
