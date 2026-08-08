/**
 * Reading a committed session back.
 *
 * C-9's own caution is why this is not optional: a throwaway directory holding one session does
 * not prove a real store is safe, so the import compares what it wrote with what the store holds
 * (FR-52) and whether the native resume list can open it (FR-51).
 */

import { readFile } from "node:fs/promises";
import type { HomePath, SessionId, StoredSessionFacts } from "./contract.js";
import { parseJsonl } from "./entries.js";
import { findSessionFile } from "./layout.js";
import { readSessionText } from "./reader.js";
import { isStructurallyOpenable } from "./validation.js";

export async function readBack(home: HomePath, sessionId: SessionId): Promise<StoredSessionFacts> {
  const absent: StoredSessionFacts = {
    sessionId,
    itemCount: 0,
    openable: false,
  };

  const file = await findSessionFile(home, sessionId);
  if (file === null) return absent;

  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return absent;
  }

  const { entries, unreadable } = parseJsonl(text);
  const read = unreadable === null ? readSessionText(text) : null;
  return {
    sessionId,
    itemCount: entries.length,
    openable:
      unreadable === null &&
      read?.unreadable === null &&
      read.turns.length > 0 &&
      isStructurallyOpenable(entries, sessionId),
  };
}
