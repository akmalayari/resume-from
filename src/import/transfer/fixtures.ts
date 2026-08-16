// Test fixtures for the transfer rules. Module-local on purpose: nothing outside
// src/import/transfer/ builds a canonical session for these tests.

import type {
  AgentId,
  CanonicalSession,
  CanonicalTurn,
  ImportConfig,
  PinReason,
  SourceProvenance,
  TargetProfile,
  TokenEstimator,
  ToolEffect,
  TransferPlan,
  TurnPin,
} from "./contract.js";

/**
 * One token per character. Deterministic and exact, so a test can state a budget
 * in characters and know precisely which turns fit.
 */
export const charEstimator: TokenEstimator = { estimate: (text) => text.length };

export function userMessage(index: number, text: string): CanonicalTurn {
  return { index, role: "user", kind: "message", text, toolCall: null, timestamp: null };
}

export function agentMessage(index: number, text: string): CanonicalTurn {
  return { index, role: "agent", kind: "message", text, toolCall: null, timestamp: null };
}

export function summaryTurn(index: number, text: string): CanonicalTurn {
  return { index, role: "agent", kind: "summary", text, toolCall: null, timestamp: null };
}

export function toolTurn(
  index: number,
  toolName: string,
  argumentsText: string,
  outcomeLine: string,
  effect: ToolEffect = "read-only",
  bodyDropped = true,
  resultRecorded = true,
): CanonicalTurn {
  return {
    index,
    role: "agent",
    kind: "tool-call",
    text: "",
    toolCall: { toolName, argumentsText, outcomeLine, effect, bodyDropped, resultRecorded },
    timestamp: null,
  };
}

/**
 * A tool-call turn that the source never answered — the broken-tail shape (FR-54).
 * The outcomeLine is non-empty (adapters always set a fallback) and resultRecorded is false.
 */
export function brokenToolTurn(
  index: number,
  toolName: string,
  argumentsText: string,
  effect: ToolEffect = "mutating",
): CanonicalTurn {
  return {
    index,
    role: "agent",
    kind: "tool-call",
    text: "",
    toolCall: {
      toolName,
      argumentsText,
      outcomeLine: `${toolName}(${argumentsText}) → (interrupted, no result recorded)`,
      effect,
      bodyDropped: false,
      resultRecorded: false,
    },
    timestamp: null,
  };
}

export function provenanceOf(agent: AgentId = "claude-code"): SourceProvenance {
  return {
    ref: { agent, home: `/homes/${agent}`, id: `${agent}-session-1` },
    title: "Fix the auth bug",
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T01:00:00.000Z",
    repo: { commit: "0f1e2d3", branch: "main", changedPaths: [] },
  };
}

export function sessionOf(
  turns: CanonicalTurn[],
  provenance: SourceProvenance = provenanceOf(),
): CanonicalSession {
  return { provenance, turns };
}

export function targetOf(windowTokens = 200_000, agent: AgentId = "codex"): TargetProfile {
  return { agent, home: `/homes/${agent}`, windowTokens };
}

/**
 * The rules read exactly two settings (module.md restates `ImportConfig` as that subset).
 *
 * Both are required parameters on purpose. Giving them the real defaults (0.30 and 5) would
 * restate values whose only home is `src/platform/config/`: when Q-1 or Q-2 is answered there,
 * every test calling `configOf()` would silently keep testing the old number. That is exactly
 * what T-CFG-8 exists to catch. Every caller already passes both explicitly.
 *
 * The two fields this module must never read are present and empty rather than cast away — a
 * fixture that lies to the type system is a worse teacher than one that supplies the whole value.
 */
export function configOf(budgetShare: number, pinnedRecentTurns: number): ImportConfig {
  return { budgetShare, pinnedRecentTurns, extraHomes: [], windowOverrides: [] };
}

/** Hangs fields the canonical vocabulary has no room for onto a value, the way a sloppy adapter would. */
export function withExtras<T extends object>(value: T, extras: Record<string, unknown>): T {
  return { ...value, ...extras } as T;
}

export function pinnedIndexes(pins: TurnPin[], reason: PinReason): number[] {
  return pins.filter((pin) => pin.reason === reason).map((pin) => pin.index);
}

export function droppedIndexes(plan: TransferPlan): number[] {
  return plan.drops.map((drop) => drop.index);
}

export function keptIndexes(plan: TransferPlan): number[] {
  return plan.turns.map((turn) => turn.index);
}
