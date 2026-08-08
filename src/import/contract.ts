// GENERATED from src/import/module.md — the Public Contract section is the normative home.
// Declarations only: no behaviour, no defaults. If this file and module.md disagree,
// the document wins and this file is corrected.

import type {
  AdapterRole,
  AgentAdapter,
  AgentCapabilities,
  AgentRuntime,
  LandingLevel,
  ProvenanceSupport,
  SelectionLevel,
  SerializedSession,
  StoredSessionFacts,
  SwitchOutcome,
  ValidationDefect,
} from "../adapters/contract.js";

export type {
  AdapterRole,
  AgentAdapter,
  AgentCapabilities,
  AgentRuntime,
  LandingLevel,
  ProvenanceSupport,
  SelectionLevel,
  SerializedSession,
  StoredSessionFacts,
  SwitchOutcome,
  ValidationDefect,
};

import type {
  HomeFailure,
  Listing,
  SearchScope,
  SelectionError,
  SelectionInput,
  SessionFinder,
} from "./discovery/contract.js";

export type { HomeFailure, Listing, SearchScope, SelectionError, SelectionInput, SessionFinder };

import type {
  HandoverInstruction,
  LandingError,
  LandingResult,
  LandingStage,
  SessionLander,
} from "./landing/contract.js";

export type { HandoverInstruction, LandingError, LandingResult, LandingStage, SessionLander };

import type {
  PreviewBuilder,
  PreviewContent,
  PreviewReport,
  PreviewWarning,
  WarningKind,
} from "./preview/contract.js";

export type { PreviewBuilder, PreviewContent, PreviewReport, PreviewWarning, WarningKind };

import type {
  DropReason,
  PinReason,
  TransferPlan,
  TransferRules,
  TurnDrop,
  TurnPin,
} from "./transfer/contract.js";

export type { DropReason, PinReason, TransferPlan, TransferRules, TurnDrop, TurnPin };

import type { HomeEntry, ImportConfig, WindowOverride } from "../platform/config/contract.js";

export type { HomeEntry, ImportConfig, WindowOverride };

import type {
  Bytes,
  CommitError,
  CommitHandle,
  CommitRefusal,
  FileCommitter,
  PendingFile,
} from "../platform/store/contract.js";

export type { Bytes, CommitError, CommitHandle, CommitRefusal, FileCommitter, PendingFile };

import type { TokenEstimator } from "../platform/tokens/contract.js";

export type { TokenEstimator };

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
} from "../session/contract.js";

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

/** What to list (FR-10, FR-15). */
export interface ListRequest {
  repoRoot: string;
  target: TargetProfile;
  onlyAgent: AgentId | null;
  onlyHome: HomePath | null;
}

/** What to preview, and later what to commit (FR-16, FR-20). */
export interface ImportRequest {
  repoRoot: string;
  target: TargetProfile;
  selection: SelectionInput;
  onlyAgent: AgentId | null;
  onlyHome: HomePath | null;
}

/** One import, from listing to landing. Every host drives these three calls. */
export interface ImportPipeline {
  list(request: ListRequest): Promise<Listing>;
  /** Writes nothing (FR-16). */
  preview(request: ImportRequest): Promise<PreviewReport>;
  /** Runs only after the user confirmed the preview (FR-20). */
  commit(
    request: ImportRequest,
    runtime: AgentRuntime,
    confirmationToken: string,
  ): Promise<LandingResult>;
}
