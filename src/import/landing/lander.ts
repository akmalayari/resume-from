import type {
  AgentAdapter,
  AgentRuntime,
  CanonicalSession,
  CommitError,
  CommitHandle,
  CommitRefusal,
  FileCommitter,
  HomePath,
  LandingResult,
  LandingStage,
  SerializedSession,
  SessionLander,
  SessionRef,
  StoredSessionFacts,
  SwitchOutcome,
  TransferPlan,
  ValidationDefect,
} from "./contract.js";
import { LandingFailure } from "./errors.js";
import { buildHandover, describeSession, type HandoverCommandBuilder } from "./handover.js";
import { buildMarker } from "./marker.js";

/** The one landing level that moves the user in (FR-43, FR-44). */
const SWITCH_LEVEL = "create-and-switch";

const RETRY = "Fix the cause, then run the import again.";

const COMMIT_NEXT_STEP: Record<CommitRefusal, string> = {
  "path-exists":
    "Nothing was created and nothing existing was touched. Remove or rename that path, then run the import again.",
  "not-writable":
    "Nothing was created. Give the target home write permission, then run the import again.",
  "write-failed":
    "Nothing was created. Check the free space and the permissions of the target home, then run the import again.",
};

function reasonOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * A rejection is only treated as a CommitError when its refusal is one this
 * module knows a next step for. Anything else gets the generic next step
 * instead of an interpolated "undefined" (FR-56).
 */
function asCommitError(cause: unknown): CommitError | null {
  if (typeof cause !== "object" || cause === null || !("refusal" in cause)) return null;
  const { refusal } = cause as { refusal: unknown };
  return typeof refusal === "string" && Object.hasOwn(COMMIT_NEXT_STEP, refusal)
    ? (cause as CommitError)
    : null;
}

/**
 * Undoes a commit and describes the failure that caused it (FR-53). A rollback
 * that itself fails is reported with the paths that may remain: silence there
 * would leave a partial session the user cannot find.
 */
async function undoAndFail(
  handle: CommitHandle,
  stage: LandingStage,
  what: string,
  home: HomePath,
): Promise<LandingFailure> {
  try {
    await handle.rollback();
    return new LandingFailure(
      stage,
      `${what} The files it had created were removed, so nothing remains in ${home}. ${RETRY}`,
      { rolledBack: true },
    );
  } catch (cause) {
    return new LandingFailure(
      stage,
      `${what} Undoing the write failed as well: ${reasonOf(cause)}. These paths may still exist and must be removed by hand: ${handle.createdPaths.join(", ")}. Remove them, then run the import again.`,
      { rolledBack: false },
    );
  }
}

async function runLanding(
  plan: TransferPlan,
  adapter: AgentAdapter,
  committer: FileCommitter,
  runtime: AgentRuntime,
  importedAt: string,
  buildCommand: HandoverCommandBuilder,
): Promise<LandingResult> {
  const home = plan.target.home;
  const target = plan.target.agent;

  // Second gate: the preview should already have stopped this plan (FR-33).
  if (plan.blockedReason !== null) {
    throw new LandingFailure(
      "serialize",
      `The plan cannot be imported: ${plan.blockedReason}. Nothing was written to ${home}. Reduce what the import must carry, or raise the budget, then run the import again.`,
    );
  }

  const capabilities = adapter.capabilities();
  const marker = buildMarker(plan, importedAt);
  const session: CanonicalSession = { provenance: plan.provenance, turns: plan.turns };

  let serialized: SerializedSession;
  try {
    serialized = adapter.serialize(session, plan.target, marker);
  } catch (cause) {
    throw new LandingFailure(
      "serialize",
      `The ${target} adapter could not turn the plan into its own session format: ${reasonOf(cause)}. Nothing was written to ${home}. ${RETRY}`,
    );
  }

  let defects: ValidationDefect[];
  try {
    defects = adapter.validate(serialized);
  } catch (cause) {
    throw new LandingFailure(
      "validate",
      `The ${target} adapter could not check the new session: ${reasonOf(cause)}. Nothing was written to ${home}. ${RETRY}`,
    );
  }
  if (defects.length > 0) {
    const summary = defects.map((defect) => `${defect.path}: ${defect.message}`).join("; ");
    throw new LandingFailure(
      "validate",
      `The new session is not valid for ${target}, so it was not placed: ${summary}. Nothing was written to ${home}. Report this as a bug, then run the import again once the adapter is fixed.`,
      { defects },
    );
  }

  let handle: CommitHandle;
  try {
    handle = await committer.commit(serialized.files);
  } catch (cause) {
    const refused = asCommitError(cause);
    const where = refused?.path ? ` (path: ${refused.path})` : "";
    const next =
      refused === null ? `Nothing was created. ${RETRY}` : COMMIT_NEXT_STEP[refused.refusal];
    throw new LandingFailure(
      "commit",
      `Creating the new session in ${home} failed: ${reasonOf(cause)}${where} ${next}`,
    );
  }

  let stored: StoredSessionFacts;
  try {
    stored = await adapter.readBack(home, serialized.sessionId);
  } catch (cause) {
    throw await undoAndFail(
      handle,
      "read-back",
      `The new session in ${home} could not be read back: ${reasonOf(cause)}.`,
      home,
    );
  }
  if (stored.itemCount !== serialized.itemCount) {
    throw await undoAndFail(
      handle,
      "read-back",
      `${target} stored ${stored.itemCount} of the ${serialized.itemCount} items that were sent, so the session is incomplete.`,
      home,
    );
  }
  if (!stored.openable) {
    throw await undoAndFail(
      handle,
      "read-back",
      `${target} could not open the new session ${serialized.sessionId}.`,
      home,
    );
  }

  const ref: SessionRef = { agent: target, home, id: serialized.sessionId };
  const landed = {
    ref,
    itemsSent: serialized.itemCount,
    itemsStored: stored.itemCount,
    marker,
  };
  const handover = () => buildHandover(buildCommand, target, serialized.sessionId);

  if (capabilities.landing !== SWITCH_LEVEL) {
    return { ...landed, switched: false, handover: handover() };
  }

  let outcome: SwitchOutcome;
  try {
    outcome = await adapter.switchTo(home, serialized.sessionId, runtime);
  } catch (cause) {
    // The session is valid, so it is kept: destroying it would destroy work.
    throw new LandingFailure(
      "switch",
      `The new session was created and is valid, but moving you into it failed: ${reasonOf(cause)}. The session was kept. Open it yourself: ${handover().command}`,
      { rolledBack: false },
    );
  }

  // A declined move is not a failure: the session stays and the user opens it later.
  return outcome.switched
    ? { ...landed, switched: true, handover: null }
    : { ...landed, switched: false, handover: handover() };
}

export interface SessionLanderOptions {
  /** Overrides the placeholder resume command. See handover.ts for the ceiling. */
  handoverCommand?: HandoverCommandBuilder;
}

export function createSessionLander(options: SessionLanderOptions = {}): SessionLander {
  const buildCommand = options.handoverCommand ?? describeSession;
  return {
    land: (plan, adapter, committer, runtime, importedAt) =>
      runLanding(plan, adapter, committer, runtime, importedAt, buildCommand),
  };
}
