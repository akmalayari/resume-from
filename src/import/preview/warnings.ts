import { realpath } from "node:fs/promises";
import type {
  CommitDistance,
  PreviewWarning,
  RepoIdentity,
  RepoReader,
  TransferPlan,
  WarningKind,
} from "./contract.js";
import { formatTokens, plural, sameCommit, shortCommit } from "./format.js";

/** Repository warnings sort first (FR-19); the rest follow this order. */
const KIND_ORDER: WarningKind[] = ["repo-state", "budget", "broken-tail", "capability"];

const NOT_KNOWN = "not known here";
const GLYPH = "⚠";

/** Orders warnings by kind, keeping the order they were added within one kind. */
export function sortWarnings(warnings: PreviewWarning[]): PreviewWarning[] {
  return [...warnings].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}

function repoState(line: string): PreviewWarning {
  return { kind: "repo-state", line };
}

/** "(14 commits ahead)", "(3 commits behind)", or "" when the tree did not move. */
function describeGap({ ahead, behind }: CommitDistance): string {
  const commits = (count: number) => `${count} ${plural(count, "commit", "commits")}`;
  if (ahead > 0 && behind > 0) return ` (${commits(ahead)} ahead, ${behind} behind)`;
  if (ahead > 0) return ` (${commits(ahead)} ahead)`;
  if (behind > 0) return ` (${commits(behind)} behind)`;
  return "";
}

/**
 * Compares the source commit with the destination HEAD (FR-37, FR-38). Returned
 * unresolved identities and unavailable commits produce non-blocking unknown-state
 * warnings (FR-36, FR-39). Rejected operational lookups, including cancellation,
 * propagate so the pipeline stops before any import write.
 */
export async function repoWarning(
  plan: TransferPlan,
  repo: RepoReader,
  cwd: string,
  identified?: RepoIdentity,
): Promise<PreviewWarning | null> {
  const identity = identified ?? (await repo.identify(cwd));

  const sourceCommit = plan.provenance.repo.commit;
  if (sourceCommit === null || sourceCommit.trim() === "") {
    return repoState(
      `${GLYPH} The source session did not record a commit, so the repository state is ${NOT_KNOWN}.`,
    );
  }

  const source = shortCommit(sourceCommit);
  if (identity.root === null) {
    return repoState(
      `${GLYPH} Source ran at ${source}. This directory's repository identity is unresolved, so the repository state is ${NOT_KNOWN}.`,
    );
  }
  if (identity.head === null) {
    return repoState(
      `${GLYPH} Source ran at ${source}. This repository has no commit yet, so the repository state is ${NOT_KNOWN}.`,
    );
  }
  if (sameCommit(sourceCommit, identity.head)) return null;

  const head = shortCommit(identity.head);
  const distance = await repo.distanceFrom(cwd, sourceCommit);
  if (!distance.known) {
    return repoState(
      `${GLYPH} Source ran at ${source}, which is ${NOT_KNOWN}. The tree is now at ${head}.`,
    );
  }

  return repoState(
    `${GLYPH} Source ran at ${source}. The tree is now at ${head}${describeGap(distance)}.`,
  );
}

/** Missing historical paths are neutral; only an existing canonical path proves a difference. */
export async function directoryWarning(
  recordedDirectories: readonly string[],
  canonicalCwd: string,
): Promise<PreviewWarning | null> {
  let differs = false;
  for (const directory of recordedDirectories) {
    try {
      if ((await realpath(directory)) !== canonicalCwd) differs = true;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    }
  }
  return differs
    ? repoState(
        `${GLYPH} The source session records a different directory. Conversation import does not transfer uncommitted work, switch branches, or recreate removed worktrees.`,
      )
    : null;
}

/** The warnings that come from the plan alone. */
export function planWarnings(plan: TransferPlan): PreviewWarning[] {
  const warnings: PreviewWarning[] = [];
  if (plan.estimatedTokens > plan.budgetTokens) {
    warnings.push({
      kind: "budget",
      line: `${GLYPH} The import is ${formatTokens(plan.estimatedTokens)} tokens, over its ${formatTokens(plan.budgetTokens)} budget.`,
    });
  }
  if (plan.brokenTailDropped) {
    warnings.push({
      kind: "broken-tail",
      line: `${GLYPH} The last tool call was incomplete and was dropped.`,
    });
  }
  return warnings;
}
