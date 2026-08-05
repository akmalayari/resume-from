// The import pipeline: list, preview, commit. A host drives these three calls and nothing
// deeper — the four stages behind them are this module's internal design, and none of them
// is exported, so no host can land a session it did not preview.

export type {
  AgentAdapter,
  AgentId,
  AgentRuntime,
  HandoverInstruction,
  HomeFailure,
  HomePath,
  ImportPipeline,
  ImportRequest,
  LandingResult,
  Listing,
  ListRequest,
  PreviewReport,
  PreviewWarning,
  SelectionInput,
  SessionDescriptor,
  SessionId,
  SessionRef,
  TargetProfile,
  WarningKind,
} from "./contract.js";
export { ImportFailure, type ImportStage } from "./errors.js";
export { createImportPipeline, type ImportPipelineDeps } from "./wiring.js";
