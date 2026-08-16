// The three operations every host drives, and the order of the four stages behind them.
// Nothing here knows an agent: the source adapter comes from the chosen session and the
// target adapter from the target profile (FR-6, FR-60).

import { confirmationMatches, confirmationToken } from "./confirmation.js";
import type {
  AgentAdapter,
  AgentRuntime,
  CanonicalSession,
  FileCommitter,
  ImportConfig,
  ImportPipeline,
  ImportRequest,
  LandingError,
  LandingResult,
  Listing,
  ListRequest,
  PreviewBuilder,
  PreviewContent,
  PreviewReport,
  SearchScope,
  SessionDescriptor,
  SessionFinder,
  SessionLander,
  TargetProfile,
  TokenEstimator,
  TransferPlan,
  TransferRules,
} from "./contract.js";
import { ImportFailure, reasonOf } from "./errors.js";

/** The role a target adapter must declare to receive an import (FR-59). */
const TARGET_ROLE = "target";

const PREVIEW_AGAIN = "Preview it again, then confirm.";
const IMPORT_AGAIN = "Fix the cause, then run the import again.";

/** The four stages, and the services they are driven with. `wiring.ts` builds them. */
export interface PipelineStages {
  finder: SessionFinder;
  rules: TransferRules;
  /** A preview builder that reads the repository the request names. */
  previewFor(repoRoot: string): PreviewBuilder;
  lander: SessionLander;
  /** Every adapter the composition root constructed. This module only looks one up. */
  adapters: readonly AgentAdapter[];
  config: ImportConfig;
  estimator: TokenEstimator;
  committer: FileCommitter;
  /** ISO-8601 UTC. Only the landing reads it, so a preview and a commit agree (FR-47). */
  now(): string;
}

/** What one recompute of the preview produced. */
interface Computed {
  descriptor: SessionDescriptor;
  plan: TransferPlan;
  report: PreviewReport;
}

function scopeOf(request: ListRequest | ImportRequest): SearchScope {
  return {
    repoRoot: request.repoRoot,
    onlyAgent: request.onlyAgent,
    onlyHome: request.onlyHome,
  };
}

/**
 * The adapter that receives the import. This lookup is the only place `AgentId` decides
 * anything in this module, and a lookup is not a branch on the pair (FR-59, FR-60).
 */
function targetAdapter(adapters: readonly AgentAdapter[], target: TargetProfile): AgentAdapter {
  const found = adapters.filter((adapter) => adapter.capabilities().agent === target.agent);
  if (found.length === 0) {
    throw new ImportFailure(
      "target",
      `There is no adapter for "${target.agent}", so an import cannot be sent to it. Run the import from an agent the tool supports, or add an adapter for "${target.agent}".`,
    );
  }
  const usable = found.find((adapter) => adapter.capabilities().roles.includes(TARGET_ROLE));
  if (!usable) {
    throw new ImportFailure(
      "target",
      `The "${target.agent}" adapter cannot receive an import: it declares the role(s) ${found[0]?.capabilities().roles.join(", ")} and not "${TARGET_ROLE}". Choose a target agent whose adapter has the "${TARGET_ROLE}" role.`,
    );
  }
  return usable;
}

/** A rejection carrying what the landing already explained (FR-50, FR-56). */
function isLandingError(cause: unknown): cause is LandingError & Error {
  return cause instanceof Error && "stage" in cause && "defects" in cause;
}

export function createPipelineFromStages(stages: PipelineStages): ImportPipeline {
  async function resolve(request: ImportRequest): Promise<SessionDescriptor> {
    try {
      return await stages.finder.resolve(scopeOf(request), request.selection);
    } catch (cause) {
      throw new ImportFailure("discovery", `The session could not be chosen: ${reasonOf(cause)}`, {
        cause,
      });
    }
  }

  async function load(descriptor: SessionDescriptor): Promise<CanonicalSession> {
    try {
      return await stages.finder.load(descriptor);
    } catch (cause) {
      throw new ImportFailure(
        "discovery",
        `The source session ${descriptor.ref.id} could not be read: ${reasonOf(cause)}. Nothing was written. Check that ${descriptor.filePath} still exists and can be read, then run the import again.`,
        { cause },
      );
    }
  }

  /**
   * Resolve, load, apply the rules, build the report. `commit` runs exactly this again
   * rather than taking a plan from the host: the numbered-list hosts of FR-10 are separate
   * processes, and a plan cannot travel between them.
   */
  async function compute(request: ImportRequest): Promise<Computed> {
    const descriptor = await resolve(request);
    const session = await load(descriptor);

    let plan: TransferPlan;
    try {
      plan = stages.rules.apply(session, request.target, stages.config, stages.estimator);
    } catch (cause) {
      throw new ImportFailure(
        "plan",
        `What to carry over could not be decided for session ${descriptor.ref.id}: ${reasonOf(cause)}. Nothing was written. ${IMPORT_AGAIN}`,
        { cause },
      );
    }

    let report: PreviewContent;
    try {
      report = await stages.previewFor(request.repoRoot).build(plan);
    } catch (cause) {
      throw new ImportFailure(
        "preview",
        `The preview of session ${descriptor.ref.id} could not be built: ${reasonOf(cause)}. Nothing was written. ${IMPORT_AGAIN}`,
        { cause },
      );
    }

    const token = confirmationToken(descriptor, plan, report);
    return {
      descriptor,
      plan,
      report: { ...report, confirmationToken: token },
    };
  }

  return {
    async list(request: ListRequest): Promise<Listing> {
      try {
        return await stages.finder.list(scopeOf(request));
      } catch (cause) {
        throw new ImportFailure(
          "discovery",
          `The sessions of this repository could not be listed: ${reasonOf(cause)}. Check that ${request.repoRoot} is readable, then run the list again.`,
          { cause },
        );
      }
    },

    async preview(request: ImportRequest): Promise<PreviewReport> {
      // Refused here as well as in commit, so a host is told about an impossible
      // target before it shows the user a preview it could never confirm.
      targetAdapter(stages.adapters, request.target);
      // A blocked plan still produces a report: the user is told why it cannot run (FR-33).
      return (await compute(request)).report;
    },

    async commit(
      request: ImportRequest,
      runtime: AgentRuntime,
      suppliedToken: string,
    ): Promise<LandingResult> {
      const adapter = targetAdapter(stages.adapters, request.target);
      const { descriptor, plan, report } = await compute(request);

      if (!confirmationMatches(report.confirmationToken, suppliedToken)) {
        throw new ImportFailure(
          "confirmation",
          `The source session or preview changed after confirmation. Nothing was written to ${request.target.home}. ${PREVIEW_AGAIN}`,
        );
      }

      if (plan.blockedReason !== null) {
        // blockedReason already ends in a sentence and carries the cause-specific
        // advice (FR-33, FR-56); this adds only what the pipeline alone knows.
        throw new ImportFailure(
          "blocked",
          `The import cannot run: ${plan.blockedReason} Nothing was written to ${request.target.home}. ${PREVIEW_AGAIN}`,
        );
      }

      // The freshness check. The listing reports when the source file last moved; the plan
      // carries when the content it was built from was last recorded. A file that moved past
      // its own last turn is a session the user has not seen (FR-20, FR-56).
      if (descriptor.updatedAt !== plan.provenance.updatedAt) {
        throw new ImportFailure(
          "source-changed",
          `The source session ${descriptor.ref.id} changed after the preview: ${descriptor.filePath} was last written at ${descriptor.updatedAt}, and the conversation the preview showed ends at ${plan.provenance.updatedAt}. Nothing was written. ${PREVIEW_AGAIN}`,
        );
      }

      try {
        return await stages.lander.land(plan, adapter, stages.committer, runtime, stages.now());
      } catch (cause) {
        // The landing states what failed and what to do next for every one of its stages;
        // anything else reaching here is a defect and gets the generic next step (FR-56).
        const known = isLandingError(cause);
        const message = known
          ? cause.message
          : `The import could not be placed in ${request.target.home}: ${reasonOf(cause)}. ${IMPORT_AGAIN}`;
        throw new ImportFailure("landing", message, {
          cause,
          defects: known ? cause.defects : [],
        });
      }
    },
  };
}
