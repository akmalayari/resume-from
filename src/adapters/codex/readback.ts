/**
 * Read-back is mandatory, not an optimisation. Codex stores what it is given without validating
 * it and drops an item type it does not know without a word (C-6), so the only evidence of what
 * was stored is what can be read back off disk (FR-52).
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentRuntime,
  HomePath,
  SessionId,
  StoredSessionFacts,
  SwitchOutcome,
} from "./contract.js";
import {
  isMessageEvent,
  isRolloutFileName,
  parseRolloutText,
  readSessionMeta,
  sessionsRoot,
} from "./rollout.js";

export async function readBackCodex(
  home: HomePath,
  sessionId: SessionId,
): Promise<StoredSessionFacts> {
  const absent: StoredSessionFacts = { sessionId, itemCount: 0, openable: false };
  const filePath = await findRollout(sessionsRoot(home), sessionId);
  if (filePath === null) return absent;

  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return absent;
  }

  const { entries, truncated } = parseRolloutText(text);
  const itemCount = entries.filter(isMessageEvent).length;
  const hasMeta = entries.some((entry) => readSessionMeta(entry)?.id === sessionId);
  return { sessionId, itemCount, openable: hasMeta && itemCount > 0 && !truncated };
}

/** Codex declares "create-only" (C-2). The landing hands the command back instead (FR-45). */
export async function switchToCodex(
  home: HomePath,
  sessionId: SessionId,
  _runtime: AgentRuntime,
): Promise<SwitchOutcome> {
  throw new Error(
    `Codex landing is "create-only": this adapter cannot move the user into a session. ` +
      `Run: CODEX_HOME=${home} codex resume ${sessionId}`,
  );
}

/** FR-51 is a fact, not an exception: a thread that is not there reports as not openable. */
async function findRollout(root: string, sessionId: SessionId): Promise<string | null> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return null;
  }
  for (const name of names.sort()) {
    const full = join(root, name);
    const info = await stat(full).catch(() => null);
    if (info === null) continue;
    if (info.isDirectory()) {
      const found = await findRollout(full, sessionId);
      if (found !== null) return found;
    } else if (isRolloutFileName(name) && name.includes(sessionId)) {
      return full;
    }
  }
  return null;
}
