/**
 * The Codex adapter: everything the tool knows about Codex, behind the one contract every
 * adapter implements (FR-57).
 */

import { randomUUID } from "node:crypto";
import type { AgentAdapter, AgentCapabilities, CodexAdapterFactory } from "./contract.js";
import { listCodexSessions, loadCodexSession } from "./read.js";
import { readBackCodex, switchToCodex } from "./readback.js";
import { defaultCodexHome } from "./rollout.js";
import { type CodexSerializeDeps, serializeCodex, validateCodex } from "./write.js";

/** Codex's own default for the models it ships with. Configuration overrides it (FR-18). */
const CODEX_WINDOW_TOKENS = 258_400;

const DEFAULT_DEPS: CodexSerializeDeps = {
  cwd: () => process.cwd(),
  newSessionId: () => randomUUID(),
};

function codexCapabilities(): AgentCapabilities {
  return {
    agent: "codex",
    roles: ["source", "target"],
    // C-1: Codex cannot host our picker, so the user picks from a numbered list we print.
    selection: "numbered-list",
    // C-2: Codex cannot move the user, so the landing hands back the command (FR-45).
    landing: "create-only",
    // Codex has no verified durable, out-of-context entry shape. The CLI prints
    // provenance after landing instead of writing it as a conversation turn.
    provenance: "host-output-only",
    defaultHome: defaultCodexHome(),
    defaultWindowTokens: CODEX_WINDOW_TOKENS,
  };
}

export const codexAdapterFactory: CodexAdapterFactory = {
  create(overrides: Partial<CodexSerializeDeps> = {}): AgentAdapter {
    const deps: CodexSerializeDeps = { ...DEFAULT_DEPS, ...overrides };
    return {
      capabilities: codexCapabilities,
      listSessions: listCodexSessions,
      loadSession: loadCodexSession,
      serialize: (session, target, marker) => serializeCodex(session, target, marker, deps),
      validate: validateCodex,
      readBack: readBackCodex,
      switchTo: switchToCodex,
    };
  },
};
