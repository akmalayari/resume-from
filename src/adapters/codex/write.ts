/**
 * The target role: a canonical session becomes a new Codex thread file.
 *
 * C-7 measured what does not work: the injection API writes `response_item` entries, and the
 * resulting thread is absent from `thread/list` and shows zero turns on resume. C-8 measured what
 * does: a file with session metadata and one `event_msg` entry per turn is listed, previewed and
 * resumed with native turns. This module writes that file, and never calls that API.
 */

import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import type {
  CanonicalSession,
  CanonicalTurn,
  ProvenanceMarker,
  SerializedSession,
  TargetProfile,
  ValidationDefect,
} from "./contract.js";
import type { RolloutEntry } from "./rollout.js";
import {
  CODEX_CLI_VERSION,
  CODEX_ENTRY_EVENT_MSG,
  CODEX_ENTRY_RESPONSE_ITEM,
  CODEX_ENTRY_SESSION_META,
  CODEX_EVENT_AGENT_MESSAGE,
  CODEX_EVENT_USER_MESSAGE,
  CODEX_ORIGINATOR,
  CODEX_SOURCE_CLI,
  isMessageEvent,
  messageTextOf,
  parseRolloutText,
  payloadType,
  rolloutFilePath,
  stringifyRollout,
} from "./rollout.js";

export function serializeCodex(
  session: CanonicalSession,
  target: TargetProfile,
  marker: ProvenanceMarker,
): SerializedSession {
  const importedAt = parseDate(marker.importedAt);
  const sessionId = randomUUID();
  const stamp = importedAt.toISOString();

  const entries: RolloutEntry[] = [sessionMetaEntry(sessionId, stamp, session)];
  // The marker is an `event_msg` entry: Codex renders it and never sends it to the model,
  // which is exactly what FR-47 and FR-48 ask for. The preview is unaffected — Codex takes
  // the preview from the first `user_message`.
  entries.push(agentMessageEntry(marker.lines.join("\n"), stamp));
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
    defects.push({ path: "files", message: "a Codex thread is exactly one rollout file" });
    return defects;
  }
  if (!isAbsolute(file.absolutePath) || !file.absolutePath.endsWith(".jsonl")) {
    defects.push({
      path: "files/0/absolutePath",
      message: `Codex reads rollouts as absolute .jsonl paths, not ${file.absolutePath}`,
    });
  }

  const { entries, truncated } = parseRolloutText(file.bytes.toString("utf8"));
  if (truncated) {
    defects.push({ path: "files/0/bytes", message: "a rollout line is not one whole JSON object" });
  }

  const meta = entries[0];
  if (meta === undefined || meta.type !== CODEX_ENTRY_SESSION_META) {
    defects.push({
      path: "items/0",
      message: "the first entry must be session metadata, or the picker cannot list the thread",
    });
  } else {
    if (meta.payload.id !== serialized.sessionId) {
      defects.push({
        path: "items/0/payload/id",
        message: "session metadata names a different session",
      });
    }
    const cwd = meta.payload.cwd;
    if (typeof cwd !== "string" || !isAbsolute(cwd)) {
      defects.push({
        path: "items/0/payload/cwd",
        message: "session metadata needs an absolute cwd",
      });
    }
    for (const field of ["originator", "cli_version"]) {
      if (typeof meta.payload[field] !== "string" || meta.payload[field] === "") {
        defects.push({
          path: `items/0/payload/${field}`,
          message: `session metadata needs ${field}`,
        });
      }
    }
    if (Number.isNaN(Date.parse(String(meta.payload.timestamp)))) {
      defects.push({
        path: "items/0/payload/timestamp",
        message: "session metadata needs an ISO timestamp",
      });
    }
  }

  const firstUser = entries.find(
    (entry) =>
      entry.type === CODEX_ENTRY_EVENT_MSG && payloadType(entry) === CODEX_EVENT_USER_MESSAGE,
  );
  if (firstUser === undefined || messageTextOf(firstUser).trim() === "") {
    defects.push({
      path: "items",
      message:
        "no user_message entry, so the preview would be empty and thread/list would not show the thread",
    });
  }

  for (const [index, entry] of entries.entries()) {
    if (entry.type === CODEX_ENTRY_RESPONSE_ITEM) {
      defects.push({
        path: `items/${index}`,
        message:
          "response_item entries fill the model history only — C-7 measured that as invisible",
      });
    }
  }

  const written = entries.filter(isMessageEvent).length;
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
      cwd: process.cwd(),
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

function parseDate(value: string): Date {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? new Date() : new Date(parsed);
}
