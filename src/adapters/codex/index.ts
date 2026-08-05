/**
 * The Codex adapter: everything the tool knows about Codex, behind the one contract every
 * adapter implements (FR-57).
 */

import type { AgentAdapter, AgentCapabilities, CodexAdapterFactory } from "./contract.js";
import { listCodexSessions, loadCodexSession } from "./read.js";
import { readBackCodex, switchToCodex } from "./readback.js";
import { defaultCodexHome } from "./rollout.js";
import { serializeCodex, validateCodex } from "./write.js";

/** Codex's own default for the models it ships with. Configuration overrides it (FR-18). */
const CODEX_WINDOW_TOKENS = 258_400;

function codexCapabilities(): AgentCapabilities {
  return {
    agent: "codex",
    roles: ["source", "target"],
    // C-1: Codex cannot host our picker, so the user picks from a numbered list we print.
    selection: "numbered-list",
    // C-2: Codex cannot move the user, so the landing hands back the command (FR-45).
    landing: "create-only",
    // `event_msg` entries are rendered but never sent to the model (C-7), which is exactly
    // the out-of-context entry FR-47 and FR-48 need.
    provenance: "out-of-context-entry",
    defaultHome: defaultCodexHome(),
    defaultWindowTokens: CODEX_WINDOW_TOKENS,
  };
}

export const codexAdapterFactory: CodexAdapterFactory = {
  create(): AgentAdapter {
    return {
      capabilities: codexCapabilities,
      listSessions: listCodexSessions,
      loadSession: loadCodexSession,
      serialize: serializeCodex,
      validate: validateCodex,
      readBack: readBackCodex,
      switchTo: switchToCodex,
    };
  },
};
