/**
 * The Claude Code session file: one JSON object per line.
 *
 * The store holds ten entry types (C-3). This module reads the few that carry turns and writes
 * exactly two, `user` and `assistant` (C-9) — fewer types, fewer ways to corrupt the store.
 */

export const ENTRY_TYPE_USER = "user";
export const ENTRY_TYPE_ASSISTANT = "assistant";
export const ENTRY_TYPE_SUMMARY = "summary";

/** The only entry types `serialize` writes (C-9). */
export const WRITTEN_ENTRY_TYPES: readonly string[] = [ENTRY_TYPE_USER, ENTRY_TYPE_ASSISTANT];

export type RawEntry = Record<string, unknown>;

export interface JsonlParse {
  entries: RawEntry[];
  /** Set when a line is not a complete entry — the file is cut mid-entry. */
  unreadable: string | null;
}

/** Parse a session file. A line that is not a complete entry makes the whole file unreadable. */
export function parseJsonl(text: string): JsonlParse {
  const entries: RawEntry[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return { entries, unreadable: `line ${i + 1} is not a complete entry` };
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { entries, unreadable: `line ${i + 1} is not an entry object` };
    }
    entries.push(value as RawEntry);
  }
  return { entries, unreadable: null };
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

export function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

/** ISO-8601 UTC, the vocabulary every timestamp of the canonical model uses. */
export function toIsoUtc(value: unknown): string | null {
  const text = asString(value);
  if (text === null) return null;
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}
