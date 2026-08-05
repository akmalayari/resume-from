/**
 * The composition root. It builds everything and drives nothing: `createHost` loads the
 * configuration, the platform services and the agent list, and the two starts below run the one
 * entry point the target agent's declared capability names.
 */

export { AGENTS, type AgentEntry } from "./agents.js";
export type {
  AgentAdapter,
  AgentCapabilities,
  AgentId,
  AgentRegistry,
  AgentRuntime,
  CliInvocation,
  CliOutcome,
  HomePath,
  HostWiring,
  ImportConfig,
  ImportPipeline,
  ImportRequest,
  Listing,
  ListRequest,
  PreviewReport,
  TargetProfile,
  TargetProfileBuilder,
} from "./contract.js";
export {
  activatePiExtension,
  type EntryPointKind,
  entryPointFor,
  type KeySource,
  type PiActivation,
  type PiCommandRegistrar,
  type PiUi,
  runCommandBinary,
} from "./entry.js";
export { createTargetProfileBuilder } from "./profile.js";
export { createAgentRegistry } from "./registry.js";
export { createHost, type Host, type HostDeps } from "./wiring.js";
