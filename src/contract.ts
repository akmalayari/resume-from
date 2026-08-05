// GENERATED from src/module.md — the Public Contract section is the normative home.
// Declarations only: no behaviour, no defaults. If this file and module.md disagree,
// the document wins and this file is corrected.

import type {
  AgentId,
  AgentRuntime,
  HandoverInstruction,
  HomePath,
  HostWiring,
  ImportPipeline,
  ImportRequest,
  LandingResult,
  SelectionInput,
  SessionId,
  SessionRef,
  TargetProfile,
} from "./host/contract.js";

export type {
  AgentId,
  AgentRuntime,
  HandoverInstruction,
  HomePath,
  HostWiring,
  ImportPipeline,
  ImportRequest,
  LandingResult,
  SelectionInput,
  SessionId,
  SessionRef,
  TargetProfile,
};

/** The package entry point (FR-57: adding an agent never changes this file). */
export interface ResumeFrom {
  /**
   * Loads configuration, builds the agent list, and returns the host wiring.
   * Called once by the command binary and once by the Pi extension.
   */
  createHost(): Promise<HostWiring>;
}
