// GENERATED from src/adapters/pi/module.md — the Public Contract section is the normative home.
// Declarations only: no behaviour, no defaults. If this file and module.md disagree,
// the document wins and this file is corrected.

import type {
  AdapterRole,
  AgentAdapter,
  AgentCapabilities,
  AgentRuntime,
  Bytes,
  LandingLevel,
  PendingFile,
  ProvenanceSupport,
  SelectionLevel,
  SerializedSession,
  StoredSessionFacts,
  SwitchOutcome,
  ValidationDefect,
} from "../contract.js";

export type {
  AdapterRole,
  AgentAdapter,
  AgentCapabilities,
  AgentRuntime,
  Bytes,
  LandingLevel,
  PendingFile,
  ProvenanceSupport,
  SelectionLevel,
  SerializedSession,
  StoredSessionFacts,
  SwitchOutcome,
  ValidationDefect,
};

import type {
  AgentId,
  CanonicalSession,
  CanonicalTurn,
  HomePath,
  ProvenanceMarker,
  RepoSnapshot,
  SessionDescriptor,
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
  ProvenanceMarker,
  RepoSnapshot,
  SessionDescriptor,
  SessionId,
  SessionRef,
  SourceProvenance,
  TargetProfile,
  ToolCallRecord,
  ToolEffect,
  TurnKind,
  TurnRole,
};

/** The options Pi's switchSession takes (C-10). */
export interface PiSwitchOptions {
  /** Pi calls this once the new session is active. */
  withSession: () => void;
}

/** What Pi's switchSession returns (C-10). */
export interface PiSwitchResult {
  cancelled: boolean;
}

/**
 * The part of Pi's command context this module uses. `src/host/pi-extension/`
 * supplies it as the AgentRuntime handle; nothing else may construct one (C-10).
 */
export interface PiSwitchContext {
  switchSession(path: string, options: PiSwitchOptions): Promise<PiSwitchResult>;
}

/** Builds the Pi adapter. The only export of this module (FR-57). */
export interface PiAdapterFactory {
  create(): AgentAdapter;
}
