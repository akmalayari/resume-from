/**
 * The target role: a canonical session becomes a new Codex thread file.
 *
 * C-7 measured what does not work: the injection API writes `response_item` entries, and the
 * resulting thread is absent from `thread/list` and shows zero turns on resume. C-8 measured what
 * does: a file with session metadata and one `event_msg` entry per turn is listed, previewed and
 * resumed with native turns. This module writes that file, and never calls that API.
 */

import { basename, isAbsolute } from "node:path";
import type {
  CanonicalSession,
  CanonicalTurn,
  ProvenanceMarker,
  SerializedSession,
  SourceProvenance,
  TargetProfile,
  ValidationDefect,
} from "./contract.js";
import type { RolloutEntry } from "./rollout.js";
import {
  CODEX_CLI_VERSION,
  CODEX_ENTRY_EVENT_MSG,
  CODEX_ENTRY_SESSION_META,
  CODEX_EVENT_AGENT_MESSAGE,
  CODEX_EVENT_USER_MESSAGE,
  CODEX_ORIGINATOR,
  CODEX_SOURCE_CLI,
  isMessageEvent,
  rolloutFilePath,
  sessionIdFromRolloutFileName,
  stringifyRollout,
} from "./rollout.js";
import { inspectCodexRollout } from "./validation.js";

// The seam's normative declaration lives in contract.ts; re-exported so existing import
// sites keep working without a second, silently driftable copy.
export type { CodexSerializeDeps } from "./contract.js";

import type { CodexSerializeDeps } from "./contract.js";

export function serializeCodex(
  session: CanonicalSession,
  target: TargetProfile,
  marker: ProvenanceMarker,
  deps: CodexSerializeDeps,
): SerializedSession {
  const importedAt = resolveStamp(marker.importedAt, session.provenance);
  const sessionId = deps.newSessionId();
  const stamp = importedAt.toISOString();

  const entries: RolloutEntry[] = [sessionMetaEntry(sessionId, stamp, deps.cwd(), session)];
  // Codex has no verified durable, out-of-context transcript entry. Do not encode
  // provenance as an agent message: that would make imported metadata look like
  // conversation and could send it back to the model on resume.
  for (const turn of session.turns) {
    const entry = turnEntry(turn, stamp);
    if (entry !== null) entries.push(entry);
  }

  return {
    sessionId,
    files: [
      {
        absolutePath: rolloutFilePath(target.home, sessionId, importedAt),
        bytes: Buffer.from(stringifyRollout(entries), "utf8"),
      },
    ],
    itemCount: entries.filter(isMessageEvent).length,
  };
}

/**
 * FR-50, read against C-7's symptoms: a thread without metadata or without a non-empty first
 * user message is invisible to the picker, and a `response_item` entry is the shape C-8 replaced.
 */
export function validateCodex(serialized: SerializedSession): ValidationDefect[] {
  const defects: ValidationDefect[] = [];
  const file = serialized.files[0];

  if (serialized.files.length !== 1 || file === undefined) {
    defects.push({
      path: "files",
      message: "a Codex thread is exactly one rollout file",
    });
    return defects;
  }
  if (!isAbsolute(file.absolutePath) || !file.absolutePath.endsWith(".jsonl")) {
    defects.push({
      path: "files/0/absolutePath",
      message: `Codex reads rollouts as absolute .jsonl paths, not ${file.absolutePath}`,
    });
  }

  if (sessionIdFromRolloutFileName(basename(file.absolutePath)) !== serialized.sessionId) {
    defects.push({
      path: "files/0/absolutePath",
      message: "the rollout filename names a different session",
    });
  }

  const inspection = inspectCodexRollout(file.bytes.toString("utf8"), serialized.sessionId);
  defects.push(...inspection.defects);

  const written = inspection.itemCount;
  if (written !== serialized.itemCount) {
    defects.push({
      path: "itemCount",
      message: `itemCount says ${serialized.itemCount}, the rollout holds ${written} items`,
    });
  }

  return defects;
}

function sessionMetaEntry(
  sessionId: string,
  stamp: string,
  cwd: string,
  session: CanonicalSession,
): RolloutEntry {
  const repo = session.provenance.repo;
  const git =
    repo.commit !== null || repo.branch !== null
      ? { git: { commit_hash: repo.commit, branch: repo.branch } }
      : {};
  return {
    timestamp: stamp,
    type: CODEX_ENTRY_SESSION_META,
    payload: {
      id: sessionId,
      session_id: sessionId,
      timestamp: stamp,
      // Where the user is now. `codex resume` filters the picker by cwd by default.
      cwd,
      originator: CODEX_ORIGINATOR,
      cli_version: CODEX_CLI_VERSION,
      source: CODEX_SOURCE_CLI,
      thread_source: "user",
      model_provider: "openai",
      ...git,
    },
  };
}

function turnEntry(turn: CanonicalTurn, fallbackStamp: string): RolloutEntry | null {
  const text = turn.kind === "tool-call" ? (turn.toolCall?.outcomeLine ?? "") : turn.text;
  if (text.trim() === "") return null;
  const stamp = turn.timestamp ?? fallbackStamp;
  return turn.role === "user" ? userMessageEntry(text, stamp) : agentMessageEntry(text, stamp);
}

function userMessageEntry(message: string, stamp: string): RolloutEntry {
  return {
    timestamp: stamp,
    type: CODEX_ENTRY_EVENT_MSG,
    payload: {
      type: CODEX_EVENT_USER_MESSAGE,
      message,
      images: [],
      local_images: [],
      text_elements: [],
    },
  };
}

function agentMessageEntry(message: string, stamp: string): RolloutEntry {
  return {
    timestamp: stamp,
    type: CODEX_ENTRY_EVENT_MSG,
    payload: {
      type: CODEX_EVENT_AGENT_MESSAGE,
      message,
      phase: "commentary",
      memory_citation: null,
    },
  };
}

/**
 * Resolve the stamp for the serialized file without reading the clock.
 * Chain: marker.importedAt → session.provenance.updatedAt → session.provenance.startedAt.
 * If none parse, fall back to the Unix epoch so serialize stays deterministic (write design
 * constraint: the preview and the commit of one request must agree, and no ambient state is read).
 */
function resolveStamp(importedAt: string, provenance: SourceProvenance): Date {
  for (const candidate of [importedAt, provenance.updatedAt, provenance.startedAt]) {
    const t = Date.parse(candidate);
    if (!Number.isNaN(t)) return new Date(t);
  }
  return new Date(0);
}
