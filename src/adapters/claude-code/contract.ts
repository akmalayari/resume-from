// GENERATED from src/adapters/claude-code/module.md — the Public Contract section is the normative home.
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

/** Builds the Claude Code adapter. The only export of this module (FR-57). */
export interface ClaudeCodeAdapterFactory {
  create(): AgentAdapter;
}
