/**
 * Read-back is mandatory, not an optimisation. Codex stores what it is given without validating
 * it and drops an item type it does not know without a word (C-6), so the only evidence of what
 * was stored is what can be read back off disk (FR-52).
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type {
  AgentRuntime,
  HomePath,
  SessionId,
  StoredSessionFacts,
  SwitchOutcome,
} from "./contract.js";
import {
  isNotFoundError,
  listRolloutFiles,
  sessionIdFromRolloutFileName,
  sessionsRoot,
} from "./rollout.js";
import { inspectCodexRollout } from "./validation.js";

export async function readBackCodex(
  home: HomePath,
  sessionId: SessionId,
): Promise<StoredSessionFacts> {
  const absent: StoredSessionFacts = {
    sessionId,
    itemCount: 0,
    openable: false,
  };
  const filePath = await findRollout(sessionsRoot(home), sessionId);
  if (filePath === null) return absent;

  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) return absent;
    throw error;
  }

  const inspection = inspectCodexRollout(text, sessionId);
  return {
    sessionId,
    itemCount: inspection.itemCount,
    openable: inspection.defects.length === 0,
  };
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
  for (const filePath of await listRolloutFiles(root)) {
    if (sessionIdFromRolloutFileName(basename(filePath)) === sessionId) return filePath;
  }
  return null;
}
