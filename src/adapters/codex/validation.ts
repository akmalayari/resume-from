import { isAbsolute } from "node:path";
import type { ValidationDefect } from "./contract.js";
import {
  CODEX_ENTRY_RESPONSE_ITEM,
  CODEX_ENTRY_SESSION_META,
  CODEX_EVENT_USER_MESSAGE,
  isMessageEvent,
  messageTextOf,
  parseRolloutText,
  payloadType,
  readSessionMeta,
} from "./rollout.js";

export interface CodexRolloutInspection {
  itemCount: number;
  defects: ValidationDefect[];
}

/** The single file-level check used both before placement and during read-back. */
export function inspectCodexRollout(
  text: string,
  expectedSessionId: string,
): CodexRolloutInspection {
  const defects: ValidationDefect[] = [];
  const { entries, truncated } = parseRolloutText(text);
  if (truncated) {
    defects.push({
      path: "files/0/bytes",
      message: "a rollout line is not one whole JSON object",
    });
  }

  const metadataEntries = entries.filter((entry) => entry.type === CODEX_ENTRY_SESSION_META);
  const metaEntry = entries[0];
  if (metaEntry === undefined || metaEntry.type !== CODEX_ENTRY_SESSION_META) {
    defects.push({
      path: "items/0",
      message: "the first entry must be session metadata, or the picker cannot list the thread",
    });
  } else {
    const meta = readSessionMeta(metaEntry);
    if (
      meta === null ||
      meta.id !== expectedSessionId ||
      metaEntry.payload.id !== expectedSessionId ||
      metaEntry.payload.session_id !== expectedSessionId
    ) {
      defects.push({
        path: "items/0/payload/id",
        message: "session metadata names a different session",
      });
    }
    if (meta === null || meta.cwd === null || !isAbsolute(meta.cwd)) {
      defects.push({
        path: "items/0/payload/cwd",
        message: "session metadata needs an absolute cwd",
      });
    }
    for (const field of ["originator", "cli_version"]) {
      if (typeof metaEntry.payload[field] !== "string" || metaEntry.payload[field] === "") {
        defects.push({
          path: `items/0/payload/${field}`,
          message: `session metadata needs ${field}`,
        });
      }
    }
    if (Number.isNaN(Date.parse(String(metaEntry.payload.timestamp)))) {
      defects.push({
        path: "items/0/payload/timestamp",
        message: "session metadata needs an ISO timestamp",
      });
    }
  }

  if (metadataEntries.length !== 1) {
    defects.push({
      path: "items",
      message: `a rollout needs exactly one session metadata entry, not ${metadataEntries.length}`,
    });
  }

  const firstUser = entries.find(
    (entry) => payloadType(entry) === CODEX_EVENT_USER_MESSAGE && isMessageEvent(entry),
  );
  if (firstUser === undefined || messageTextOf(firstUser).trim() === "") {
    defects.push({
      path: "items",
      message:
        "no non-empty user_message entry, so the preview would be empty and thread/list would not show the thread",
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

  return {
    itemCount: entries.filter(isMessageEvent).length,
    defects,
  };
}
