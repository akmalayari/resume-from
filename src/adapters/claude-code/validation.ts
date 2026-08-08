import type { SessionId } from "./contract.js";
import {
  asArray,
  asObject,
  asString,
  ENTRY_TYPE_ASSISTANT,
  ENTRY_TYPE_USER,
  type RawEntry,
  resolveActiveEntryPath,
  toIsoUtc,
} from "./entries.js";

function hasVisibleContent(content: unknown): boolean {
  return (typeof content === "string" && content.length > 0) || (asArray(content)?.length ?? 0) > 0;
}

function isStoredTurn(entry: RawEntry, sessionId: SessionId): boolean {
  const expectedRole = entry.type === ENTRY_TYPE_ASSISTANT ? "assistant" : "user";
  const message = asObject(entry.message);
  if (
    asString(entry.uuid) === null ||
    entry.sessionId !== sessionId ||
    toIsoUtc(entry.timestamp) === null ||
    (entry.parentUuid !== null && typeof entry.parentUuid !== "string") ||
    message?.role !== expectedRole ||
    !hasVisibleContent(message.content)
  ) {
    return false;
  }
  if (entry.type === ENTRY_TYPE_ASSISTANT) {
    return asString(message.model) !== null && asObject(message.usage) !== null;
  }
  return true;
}

/** Structural facts required for a committed Claude transcript to be resumable by identity. */
export function isStructurallyOpenable(entries: RawEntry[], sessionId: SessionId): boolean {
  let turnCount = 0;
  for (const entry of entries) {
    if (entry.sessionId !== undefined && entry.sessionId !== sessionId) return false;
    if (entry.type !== ENTRY_TYPE_USER && entry.type !== ENTRY_TYPE_ASSISTANT) continue;
    turnCount++;
    if (!isStoredTurn(entry, sessionId)) return false;
  }
  if (turnCount === 0) return false;

  const active = resolveActiveEntryPath(entries);
  if (active.unreadable !== null) return false;
  return active.entries.some(
    (entry) => entry.type === ENTRY_TYPE_USER || entry.type === ENTRY_TYPE_ASSISTANT,
  );
}
