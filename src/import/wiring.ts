// The Internal Design, as code: this module builds its four stages and nothing else builds
// them. Everything the stages need arrives from src/host/ — this module constructs no adapter,
// no committer, no estimator and no configuration.

import type { RepoReader } from "../platform/repo/contract.js";
import type {
  AgentAdapter,
  FileCommitter,
  ImportConfig,
  ImportPipeline,
  TokenEstimator,
} from "./contract.js";
import { createSessionFinder } from "./discovery/index.js";
import { createSessionLander, type HandoverCommandBuilder } from "./landing/index.js";
import { createPipelineFromStages, type PipelineStages } from "./pipeline.js";
import { createPreviewBuilder } from "./preview/index.js";
import { createTransferRules } from "./transfer/index.js";

export interface ImportPipelineDeps {
  /** Every constructed adapter, in the order the composition root listed them (FR-57). */
  adapters: readonly AgentAdapter[];
  config: ImportConfig;
  estimator: TokenEstimator;
  committer: FileCommitter;
  /** Read by the preview to say how far the tree moved (FR-37, FR-38). */
  repo: RepoReader;
  /**
   * The import time written into the marker (FR-47). Injected because no stage may read a
   * clock: a preview and the commit that follows it must compute the same plan.
   */
  now?: () => string;
  /** Renders an agent's own resume command for the handover (FR-45). */
  handoverCommand?: HandoverCommandBuilder;
}

/** The four stages, wired. Internal: a host builds a pipeline, never a stage. */
export function buildStages(deps: ImportPipelineDeps): PipelineStages {
  return {
    finder: createSessionFinder({ adapters: deps.adapters, config: deps.config }),
    rules: createTransferRules(),
    // Per request: the preview reads the repository the request names (FR-13, FR-37).
    previewFor: (repoRoot: string) => createPreviewBuilder(deps.repo, repoRoot),
    lander: createSessionLander(
      deps.handoverCommand === undefined ? {} : { handoverCommand: deps.handoverCommand },
    ),
    adapters: deps.adapters,
    config: deps.config,
    estimator: deps.estimator,
    committer: deps.committer,
    now: deps.now ?? (() => new Date().toISOString()),
  };
}

/** One import, from listing to landing. The only thing a host constructs here. */
export function createImportPipeline(deps: ImportPipelineDeps): ImportPipeline {
  return createPipelineFromStages(buildStages(deps));
}
