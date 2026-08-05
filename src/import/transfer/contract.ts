// GENERATED from src/import/transfer/module.md — the Public Contract section is the normative home.
// Declarations only: no behaviour, no defaults. If this file and module.md disagree,
// the document wins and this file is corrected.

import type { ImportConfig } from "../../platform/config/contract.js";

export type { ImportConfig };

import type { TokenEstimator } from "../../platform/tokens/contract.js";

export type { TokenEstimator };

import type {
  AgentId,
  CanonicalSession,
  CanonicalTurn,
  HomePath,
  RepoSnapshot,
  SessionId,
  SessionRef,
  SourceProvenance,
  TargetProfile,
  ToolCallRecord,
  ToolEffect,
  TurnKind,
  TurnRole,
} from "../../session/contract.js";

export type {
  AgentId,
  CanonicalSession,
  CanonicalTurn,
  HomePath,
  RepoSnapshot,
  SessionId,
  SessionRef,
  SourceProvenance,
  TargetProfile,
  ToolCallRecord,
  ToolEffect,
  TurnKind,
  TurnRole,
};

/** Why a turn did not cross over (FR-31, FR-54). */
export type DropReason = "budget" | "broken-tail";

/** Why a turn is kept whatever the budget says (FR-32). */
export type PinReason = "first-request" | "recent-turn" | "summary" | "changed-files";

/** One turn the rules removed. */
export interface TurnDrop {
  /** The turn's index in the source session. */
  index: number;
  reason: DropReason;
}

/** One turn the rules protected. */
export interface TurnPin {
  /** The turn's index in the source session. */
  index: number;
  reason: PinReason;
}

/** The result of applying requirement sections D and E to one source session. */
export interface TransferPlan {
  target: TargetProfile;
  /** The source metadata, unchanged. */
  provenance: SourceProvenance;
  /** Only the turns that cross over, in source order. */
  turns: CanonicalTurn[];
  pins: TurnPin[];
  drops: TurnDrop[];
  keptTurnCount: number;
  droppedTurnCount: number;
  /** Tool result bodies the rules removed (FR-24, FR-25). */
  bodiesDropped: number;
  /** Estimated cost of the kept turns, in tokens. */
  estimatedTokens: number;
  /** budgetShare multiplied by the target window, rounded down (FR-29, FR-30). */
  budgetTokens: number;
  /** True when an incomplete trailing tool call was removed (FR-54, FR-55). */
  brokenTailDropped: boolean;
  /** Set when the pinned content alone exceeds the budget. The import cannot run (FR-33). */
  blockedReason: string | null;
}

/** Applies requirement sections D and E. Pure: the same input always gives the same plan. */
export interface TransferRules {
  apply(
    session: CanonicalSession,
    target: TargetProfile,
    config: ImportConfig,
    estimator: TokenEstimator,
  ): TransferPlan;
}
