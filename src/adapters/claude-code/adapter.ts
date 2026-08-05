/**
 * The Claude Code adapter: the port of `src/adapters/`, filled in with what this module knows
 * about Claude Code.
 */

import type {
  AgentAdapter,
  AgentCapabilities,
  AgentRuntime,
  CanonicalSession,
  ClaudeCodeAdapterFactory,
  HomePath,
  ProvenanceMarker,
  SerializedSession,
  SessionDescriptor,
  SessionId,
  StoredSessionFacts,
  SwitchOutcome,
  TargetProfile,
  ValidationDefect,
} from "./contract.js";
import { resolveDefaultHome } from "./layout.js";
import { readBack } from "./readback.js";
import { listSessions, loadSession } from "./reader.js";
import { serialize, validate } from "./writer.js";

/** Claude Code's context window, used when configuration overrides none (FR-18). */
export const DEFAULT_WINDOW_TOKENS = 200_000;
/** The command the landing hands back, because Claude Code cannot move the user (C-2, FR-45). */
export const HANDOVER_COMMAND = "claude --resume";

export interface ClaudeCodeAdapterDeps {
  /**
   * The repository the import runs in. Claude Code keys a session to a repository, and no
   * argument of the port names one, so the working directory is the signal.
   */
  cwd: string;
  env: Record<string, string | undefined>;
  homeDir: string;
}

/**
 * Build the adapter. `deps` exists for the tests of this module: the shipped factory below
 * passes the real process values.
 */
export function createClaudeCodeAdapter(deps: Partial<ClaudeCodeAdapterDeps> = {}): AgentAdapter {
  const cwd = deps.cwd ?? process.cwd();
  const env = deps.env ?? process.env;

  // Resolved once: capabilities() is pure, synchronous, and equal on every call.
  const capabilities: AgentCapabilities = Object.freeze({
    agent: "claude-code" as const,
    roles: ["source" as const, "target" as const],
    selection: "numbered-list" as const,
    landing: "create-only" as const,
    provenance: "out-of-context-entry" as const,
    defaultHome:
      deps.homeDir === undefined ? resolveDefaultHome(env) : resolveDefaultHome(env, deps.homeDir),
    defaultWindowTokens: DEFAULT_WINDOW_TOKENS,
  });

  return {
    capabilities(): AgentCapabilities {
      return capabilities;
    },

    listSessions(home: HomePath): Promise<SessionDescriptor[]> {
      return listSessions(home);
    },

    loadSession(descriptor: SessionDescriptor): Promise<CanonicalSession> {
      return loadSession(descriptor);
    },

    serialize(
      session: CanonicalSession,
      target: TargetProfile,
      marker: ProvenanceMarker,
    ): SerializedSession {
      return serialize(session, target, marker, { cwd });
    },

    validate(serialized: SerializedSession): ValidationDefect[] {
      return validate(serialized);
    },

    readBack(home: HomePath, sessionId: SessionId): Promise<StoredSessionFacts> {
      return readBack(home, sessionId);
    },

    switchTo(
      _home: HomePath,
      sessionId: SessionId,
      _runtime: AgentRuntime,
    ): Promise<SwitchOutcome> {
      return Promise.reject(
        new Error(
          'Claude Code declares landing "create-only": it cannot move the user into a session ' +
            `(C-2). Run: ${HANDOVER_COMMAND} ${sessionId}`,
        ),
      );
    },
  };
}

/** The only export of this module (FR-57). */
export const claudeCodeAdapter: ClaudeCodeAdapterFactory = {
  create(): AgentAdapter {
    return createClaudeCodeAdapter();
  },
};
